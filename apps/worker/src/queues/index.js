// apps/worker/src/queues/index.ts
import { Worker, Queue, QueueEvents } from "bullmq";
import { connection } from "../redis";
import { ObjectId } from "mongodb";
import { col } from "../db";
import { appendDraft } from "../adapters/imap-append";
import { emit } from "../pub";
import { checkThreshold } from "../policy/thresholds";
import { pickSlot } from "../policy/availability";
import { buildIcs } from "../util/ics";
import { upsertEvent } from "../adapters/caldav";
export const eventsQueue = new Queue("events", { connection });
export const decisionsQueue = new Queue("decisions", { connection });
export const executeQueue = new Queue("execute", { connection });
new QueueEvents("events", { connection });
new QueueEvents("decisions", { connection });
new QueueEvents("execute", { connection });
const defaultOpts = { removeOnComplete: true, removeOnFail: 50 };
async function mdToHtml(md) {
    // super basic; replace with a proper MD renderer if you want
    return md.replace(/\n/g, "<br/>");
}
function mdToPlain(md) {
    return md.replace(/\r?\n/g, "\r\n");
}
function buildMime({ from, to, subject, text }) {
    const headers = [
        `From: ${from}`,
        `To: ${to.join(", ")}`,
        `Subject: ${subject}`,
        `MIME-Version: 1.0`,
        `Content-Type: text/plain; charset=utf-8`,
        ``,
    ].join("\r\n");
    return Buffer.from(headers + mdToPlain(text) + "\r\n");
}
/**
 * EVENTS → DECISIONS
 * Accepts: { tenantId: string, ...payload }
 */
export const eventsWorker = new Worker("events", async (job) => {
    const { tenantId, ...rest } = job.data;
    console.log("[events] job:", job.name, job.id, job.data);
    await emit(tenantId, { kind: "queued", queue: "events", id: job.id, data: rest });
    // Echo to decisions as a demo
    await decisionsQueue.add("plan", { tenantId, fromEvent: rest }, defaultOpts);
}, { connection });
/**
 * DECISIONS
 * Creates a pending DecisionLog that requires approval.
 */
export const decisionsWorker = new Worker("decisions", async (job) => {
    const { tenantId, threadId } = job.data;
    // Fetch minimal context for the draft
    const threads = await col("MailThread");
    const msgs = await col("MailMessage");
    const thread = await threads.findOne({ _id: threadId, tenantId });
    const last = await msgs.find({ tenantId, threadId }).sort({ date: -1 }).limit(1).next();
    // Make a *real* action for approvals
    const action = {
        type: "create_draft_reply",
        payload: {
            threadId,
            to: (thread?.participants ?? []).filter(e => e.includes("@")).slice(0, 1),
            subject: thread?.subject?.startsWith("Re:") ? thread.subject : `Re: ${thread?.subject ?? ""}`,
            body_md: `Hi,\n\nThanks for your email.\n\nBest,\nKadoo`,
        },
    };
    // Confidence is just a demo
    const needsApproval = true;
    if (needsApproval) {
        const logs = await col("DecisionLog");
        const { insertedId } = await logs.insertOne({
            tenantId,
            employeeId: "ea-1",
            createdAt: new Date(),
            status: "pending",
            requiresApproval: true,
            confidence: 0.92,
            action,
        });
        console.log("[approvals] queued pending id:", insertedId.toString());
        return;
    }
    // else enqueue execute directly…
    await executeQueue.add("create_draft_reply", action.payload, { removeOnComplete: true });
}, { connection });
/**
 * EXECUTE
 * Consumes an approved action, updates the corresponding DecisionLog.
 * Expects: { tenantId: string, logId: string, ...payload }
 */
export const executeWorker = new Worker("execute", async (job) => {
    const { tenantId, logId, ...payload } = job.data;
    const logs = await col("DecisionLog");
    const connectors = await col("MailboxConnector");
    const _id = new ObjectId(logId);
    const doc = await logs.findOne({ _id, tenantId });
    if (!doc)
        return;
    switch (doc.action.type) {
        case "create_draft_reply": {
            const { tenantId, threadId, to, subject, body_md } = job.data;
            // Get the connector for this tenant (MVP: single connector)
            const connectors = await col("MailboxConnector");
            const conn = await connectors.findOne({ tenantId, type: "imap" });
            if (!conn)
                throw new Error("No connector");
            const from = conn.imap.user;
            const raw = buildMime({ from, to, subject: subject ?? "", text: body_md });
            await appendDraft(conn, raw);
            // mark log executed if present
            const logs = await col("DecisionLog");
            await logs.updateOne({ tenantId, "action.payload.threadId": threadId, status: { $in: ["pending", "approved"] } }, { $set: { status: "executed", executedAt: new Date(), result: { ok: true, kind: "draft" } } });
            return;
        }
        case "schedule_meeting": {
            // Pull the action payload from the decision log
            // Expecting: { attendeeEmail, durationMin, windowISO: string[], conference? }
            const a = (doc.action.payload ?? doc.action);
            // Confidence (from your pending log)
            const confidence = doc.confidence;
            // Load an EA employee for thresholds (or default 0.75)
            const employeesCol = await col("Employee");
            const employee = (await employeesCol.findOne({ tenantId, role: "ea" })) ??
                { thresholds: { schedule: 0.75 } };
            if (!checkThreshold(confidence, employee.thresholds?.schedule ?? 0.75)) {
                await logs.updateOne({ _id, tenantId }, { $set: { status: "denied", deniedReason: "threshold", updatedAt: new Date() } });
                return;
            }
            // Choose a slot
            const slot = await pickSlot({
                tenantId,
                windowISO: a.windowISO,
                durationMin: a.durationMin,
                buffers: { before: 10, after: 10 },
                minNoticeMin: 720, // 12h
            });
            if (!slot) {
                await logs.updateOne({ _id, tenantId }, { $set: { status: "failed", failReason: "no_slot", updatedAt: new Date() } });
                return;
            }
            // Load tenant to get organiser email / defaults
            const tenants = await col("Tenant");
            const tenantDoc = await tenants.findOne({ _id: tenantId });
            const organizerEmail = tenantDoc?.organizerEmail ||
                tenantDoc?.settings?.defaultOrganizer ||
                "no-reply@kadoo.local";
            // Build ICS
            const ics = buildIcs({
                summary: `Meeting with ${tenantDoc?.name ?? "Kadoo"}`,
                start: slot.start,
                end: slot.end,
                attendees: [{ email: a.attendeeEmail }],
                organizer: organizerEmail,
                conference: a.conference,
                location: tenantDoc?.settings?.defaultLocation,
                description: `Auto-booked by Kadoo EA`,
            });
            // Find CalDAV connector
            const calConns = await col("cal_connectors");
            const cal = await calConns.findOne({ tenantId, type: "caldav", status: "active" });
            if (!cal) {
                await logs.updateOne({ _id, tenantId }, { $set: { status: "failed", failReason: "no_caldav_connector", updatedAt: new Date() } });
                return;
            }
            // Create event on CalDAV
            const href = await upsertEvent({
                principalUrl: cal.principalUrl,
                calendarUrl: cal.calendarUrl,
                username: cal.username,
                password: /* decrypt */ cal.passwordEnc,
                syncToken: cal.syncToken,
            }, ics);
            // Mark executed
            await logs.updateOne({ _id, tenantId }, {
                $set: {
                    status: "executed",
                    executedAt: new Date(),
                    result: { ok: true, kind: "calendar", href, slot },
                },
            });
            await emit(tenantId, {
                kind: "meeting_scheduled",
                href,
                slot,
                attendee: a.attendeeEmail,
            });
            return;
        }
        default:
            // fallback existing behaviour
            await logs.updateOne({ _id, tenantId }, { $set: { status: "executed", executedAt: new Date(), result: payload } });
            await emit(tenantId, { kind: "executed", logId, action: doc.action.type });
            return;
    }
}, { connection });
