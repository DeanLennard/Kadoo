// apps/worker/src/queues/index.ts
import { Worker, Queue, QueueEvents, type JobsOptions } from "bullmq";
import { connection } from "../redis";
import { ObjectId } from "mongodb";
import { col } from "../db";
import type { MailboxConnector, MailThread, MailMessage } from "@kadoo/types";
import { makeSmtp } from "../adapters/smtp";
import { appendDraft, resolveSentMailbox, appendToMailbox } from "../adapters/imap-append";
import { emit } from "../pub";
import { checkThreshold } from "../policy/thresholds";
import { pickSlot } from "../policy/availability";
import { buildIcs } from "../util/ics";
import { upsertEvent } from "../adapters/caldav";
import { buildMixedMime } from "../util/buildMixedMime";
import { buildIcsReply } from "../util/buildIcsReply";
import { buildCalendarReplyMime } from "../util/buildCalendarReplyMime";
import { buildAcceptedEvent } from "../util/buildAcceptedEvent";
import { spendCreditsAndLog } from "../util/credits";
import { getActiveEA, hasPermission, allowAuto, minThreshold } from "../util/employee";

type EmployeeSettings = {
    _id: string;
    tenantId: string;
    name: string;
    email?: string;
    role: "ea" | "agent" | "bot";
    enabled: boolean;
    permissions: {
        canSendEmails: boolean;
        canProposeTimes: boolean;
        canAcceptInvites: boolean;
        canDeclineInvites: boolean;
        canScheduleMeetings: boolean;
    };
    auto?: {
        sendWithoutApproval?: {
            send_reply?: boolean;
            send_calendar_reply?: boolean;
            schedule_meeting?: boolean;
        };
        thresholds?: {
            send_reply?: number;
            send_calendar_reply?: number;
            schedule_meeting?: number;
        };
    };
};

type ModelDecision =
    | { actionType: "send_reply";          confidence?: number; payload?: any }
    | { actionType: "send_calendar_reply"; confidence?: number; payload?: any }
    | { actionType: "schedule_meeting";    confidence?: number; payload?: any };

type DecisionsJob = {
    tenantId: string;
    threadId: string;
    decision?: ModelDecision; // ← optional
};

function actionToPermissionKey(actionType: string):
    | keyof EmployeeSettings["permissions"]
    | null {
    switch (actionType) {
        case "send_reply":            return "canSendEmails";
        case "send_calendar_reply":   return "canAcceptInvites";     // accept/decline
        case "schedule_meeting":      return "canScheduleMeetings";
        case "create_draft_reply":    return "canSendEmails";        // drafting is still “send emails”
        default: return null;
    }
}

export const eventsQueue = new Queue("events", { connection });
export const decisionsQueue = new Queue("decisions", { connection });
export const executeQueue = new Queue("execute", { connection });

new QueueEvents("events", { connection });
new QueueEvents("decisions", { connection });
new QueueEvents("execute", { connection });

const defaultOpts: JobsOptions = { removeOnComplete: true, removeOnFail: 50 };

async function mdToHtml(md: string) {
    // super basic; replace with a proper MD renderer if you want
    return md.replace(/\n/g, "<br/>");
}

function mdToPlain(md: string) {
    return md.replace(/\r?\n/g, "\r\n");
}

function buildMime({ from, to, subject, text }: { from: string; to: string[]; subject: string; text: string }) {
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

export async function appendSent(connCfg: MailboxConnector, raw: Buffer) {
    try {
        const sentPath = await resolveSentMailbox(connCfg);
        await appendToMailbox(connCfg, raw, sentPath); // defaults to ["\\Seen"]
    } catch (e) {
        console.warn("[imap] append to Sent failed", String(e));
    }
}

/**
 * EVENTS → DECISIONS
 * Accepts: { tenantId: string, ...payload }
 */
export const eventsWorker = new Worker(
    "events",
    async (job) => {
        const { tenantId, ...rest } = job.data as { tenantId: string; [k: string]: any };
        console.log("[events] job:", job.name, job.id, job.data);

        await emit(tenantId, { kind: "queued", queue: "events", id: job.id, data: rest });

        // Echo to decisions as a demo
        await decisionsQueue.add("plan", {
            tenantId,
            threadId: rest.threadId,
            decision: rest.decision ?? undefined
        }, defaultOpts);
    },
    { connection }
);

/**
 * DECISIONS
 * Creates a pending DecisionLog that requires approval.
 */
export const decisionsWorker = new Worker(
    "decisions",
    async (job) => {
        const { tenantId, threadId, decision } = job.data as {
            tenantId: string;
            threadId: string;
            decision?: { actionType: "send_reply" | "send_calendar_reply" | "schedule_meeting"; confidence?: number; payload?: any };
        };

        // build your action (for send_reply, or map from decision?.payload if provided)
        const action = decision?.actionType === "send_calendar_reply"
            ? { type: "send_calendar_reply" as const, payload: decision?.payload }
            : { type: "create_draft_reply" as const, payload: { threadId, to: [], subject: "", body_md: "Hi,\n\nThanks...", } };

        const emp = await getActiveEA(tenantId);
        const actionType = (decision?.actionType ?? "send_reply") as "send_reply" | "send_calendar_reply" | "schedule_meeting";
        const confidence = decision?.confidence ?? 0.9;

        const permOk = hasPermission(emp, actionType);
        const canAuto = allowAuto(emp, actionType);
        const thresh  = minThreshold(emp, actionType, actionType === "send_calendar_reply" ? 0.85 : 0.9);

        const requiresApproval = !emp?.enabled || !permOk || !canAuto || confidence < thresh;

        const logs = await col("DecisionLog");
        const { insertedId } = await logs.insertOne({
            tenantId,
            employeeId: emp?._id ?? "ea-none",
            createdAt: new Date(),
            status: requiresApproval ? "pending" : "approved",
            requiresApproval,
            confidence,
            action,
        });

        if (!requiresApproval) {
            await executeQueue.add(
                action.type,
                { tenantId, logId: insertedId.toString(), ...action.payload },
                { removeOnComplete: true, removeOnFail: 50 }
            );
        }
    },
    { connection }
);

/**
 * EXECUTE
 * Consumes an approved action, updates the corresponding DecisionLog.
 * Expects: { tenantId: string, logId: string, ...payload }
 */
export const executeWorker = new Worker(
    "execute",
    async (job) => {
        console.log("[execute] start", job.name, job.id, job.data);

        const { tenantId, logId, ...payload } = job.data as any;

        if (!logId) {
            console.error("[execute] missing logId in job.data", job.data);
            return;
        }

        const logs = await col("DecisionLog");
        const connectors = await col<MailboxConnector>("MailboxConnector");
        const _id = new ObjectId(logId);
        const doc = await logs.findOne({ _id, tenantId });
        if (!doc) {
            console.error("[execute] DecisionLog not found", { tenantId, logId });
            return;
        }

        console.log("[execute] action.type", doc.action?.type);

        const emp = await getActiveEA(tenantId);

        function guardOrDeny(
            actionType: "send_reply" | "send_calendar_reply" | "schedule_meeting" | "create_draft_reply"
        ) {
            if (!emp) {
                return { ok: false as const, reason: "ea_missing" as const };
            }
            if (!emp.enabled) {
                return { ok: false as const, reason: "ea_disabled" as const };
            }
            const key = actionToPermissionKey(actionType);
            if (key && !emp.permissions?.[key]) {
                return { ok: false as const, reason: "permission_denied" as const };
            }
            return { ok: true as const };
        }

        switch (doc.action.type) {
            case "create_draft_reply": {
                const { tenantId, threadId, to, subject, body_md } = job.data as {
                    tenantId: string; threadId: string; to: string[]; subject?: string; body_md: string;
                };

                const g = guardOrDeny("create_draft_reply");
                if (!g.ok) {
                    await logs.updateOne(
                        { _id, tenantId },
                        { $set: { status: "denied", deniedReason: g.reason, updatedAt: new Date() } }
                    );

                    await emit(tenantId, {
                        kind: "action_denied",
                        logId: _id.toString(),
                        reason: g.reason,
                        action: doc.action.type,
                    });

                    return;
                }

                // Get the connector for this tenant (MVP: single connector)
                const connectors = await col<MailboxConnector>("MailboxConnector");
                const conn = await connectors.findOne({ tenantId, type: "imap" });
                if (!conn) throw new Error("No connector");

                const from = conn.imap!.user;
                const raw = buildMime({ from, to, subject: subject ?? "", text: body_md });

                await appendDraft(conn, raw);

                // mark log executed if present
                await logs.updateOne(
                    { tenantId, "action.payload.threadId": threadId, status: { $in: ["pending", "approved"] } },
                    { $set: { status: "executed", executedAt: new Date(), result: { ok: true, kind: "draft" } } },
                );
                await spendCreditsAndLog({ tenantId, cost: 2, action: "create_draft_reply", threadId });
                return;
            }

            case "send_reply": {
                const { tenantId, threadId, to, subject, body_md, body_html } = job.data as any;

                const g = guardOrDeny("send_reply");
                if (!g.ok) {
                    await logs.updateOne(
                        { _id, tenantId },
                        { $set: { status: "denied", deniedReason: g.reason, updatedAt: new Date() } }
                    );

                    await emit(tenantId, {
                        kind: "action_denied",
                        logId: _id.toString(),
                        reason: g.reason,
                        action: doc.action.type,
                    });

                    return;
                }

                const connectors = await col<MailboxConnector>("MailboxConnector");
                const conn = await connectors.findOne({ tenantId, type: "imap" });
                if (!conn) throw new Error("No connector for SMTP sender");

                const from = conn.imap!.user;
                const mime = buildMixedMime({ from, to, subject, text: body_md, html: body_html });

                const smtp = makeSmtp(conn);

                const withTimeout = <T,>(p: Promise<T>, ms = 20000) =>
                    Promise.race<T>([
                        p,
                        new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`SMTP timeout after ${ms}ms`)), ms)),
                    ]);

                try {
                    console.log("[smtp] verify.start");
                    const ok = await withTimeout(smtp.verify());
                    console.log("[smtp] verify.ok", ok);
                } catch (e) {
                    console.error("[smtp] verify.failed", String(e));
                    await logs.updateOne(
                        { _id, tenantId },
                        { $set: { status: "failed", failReason: "smtp_verify", error: String(e), updatedAt: new Date() } }
                    );
                    return;
                }

                try {
                    console.log("[smtp] sendMail.start", { to, subject });
                    const info = await withTimeout(
                        smtp.sendMail({
                            raw: mime,                 // full RFC822
                            envelope: { from, to },    // SMTP MAIL FROM / RCPT TO
                        }),
                        25000
                    );

                    console.log("[smtp] result", {
                        messageId: info.messageId,
                        accepted: info.accepted,
                        rejected: info.rejected,
                        response: info.response,
                    });

                    if (!info.accepted || info.accepted.length === 0) {
                        await logs.updateOne(
                            { _id, tenantId },
                            { $set: { status: "failed", failReason: "smtp_rejected", smtp: info, updatedAt: new Date() } }
                        );
                        return;
                    }

                    try {
                        await appendSent(conn, Buffer.isBuffer(mime) ? mime : Buffer.from(mime));
                        console.log("[imap] appended to Sent");
                    } catch (e) {
                        console.warn("[imap] failed to append to Sent:", String(e));
                    }

                    await logs.updateOne(
                        { _id, tenantId },
                        { $set: { status: "executed", executedAt: new Date(), result: { ok: true, kind: "sent", smtp: info } } }
                    );

                    try {
                        const newBal = await spendCreditsAndLog({
                            tenantId,
                            cost: 5,
                            action: "send_reply",
                            threadId,
                            meta: { messageId: info.messageId, accepted: info.accepted }
                        });
                        // (Optional) emit an SSE event so the dashboard updates live
                        await emit(tenantId, { kind: "credits_update", balance: newBal, delta: -5 });
                    } catch (e) {
                        console.warn("[credits] spend/log failed", String(e));
                    }

                } catch (e) {
                    console.error("[smtp] sendMail.failed", String(e));
                    await logs.updateOne(
                        { _id, tenantId },
                        { $set: { status: "failed", failReason: "smtp_send", error: String(e), updatedAt: new Date() } }
                    );
                }
                return;
            }

            case "send_calendar_reply": {
                const { tenantId, threadId, to, subject, body_md, body_html, ics_uid, ics_summary, ics_organizer, attendee_email, attendee_name, start, end, location } = job.data as any;

                const g = guardOrDeny("send_calendar_reply");
                if (!g.ok) {
                    await logs.updateOne(
                        { _id, tenantId },
                        { $set: { status: "denied", deniedReason: g.reason, updatedAt: new Date() } }
                    );

                    await emit(tenantId, {
                        kind: "action_denied",
                        logId: _id.toString(),
                        reason: g.reason,
                        action: doc.action.type,
                    });

                    return;
                }

                // load connector (same as other cases)
                const connectors = await col<MailboxConnector>("MailboxConnector");
                const conn = await connectors.findOne({ tenantId, type: "imap" });
                if (!conn) throw new Error("No connector for SMTP sender");

                const from = conn.imap!.user;

                // Build ICS REPLY
                const ics = buildIcsReply({
                    uid: ics_uid,
                    organizerEmail: ics_organizer || to?.[0],
                    attendeeEmail: attendee_email || from,
                    attendeeName: attendee_name,
                    summary: ics_summary,
                });

                // Build MIME with calendar part
                const raw = buildCalendarReplyMime({
                    from,
                    to,
                    subject,
                    text: body_md,
                    html: body_html,
                    ics,
                });

                // SEND
                const smtp = makeSmtp(conn);
                const info = await smtp.sendMail({ raw, envelope: { from, to } });
                console.log("[smtp] calendar reply result", {
                    messageId: info.messageId,
                    accepted: info.accepted,
                    rejected: info.rejected,
                    response: info.response,
                });

                // Append to Sent (optional but nice)
                try {
                    await appendToMailbox(conn, raw, "Sent");
                } catch (e) {
                    console.warn("[imap] append to Sent failed", String(e));
                }

                // Also ensure *your* calendar has the event (accepted)
                try {
                    const calConns = await col("cal_connectors");
                    const cal = await calConns.findOne({ tenantId, type: "caldav", status: "active" });

                    // ✅ Decrypt your stored password here
                    const decrypt = (s: string) => /* your real decrypt */ s;
                    if (cal && ics_uid && start && end) {
                        const eventIcs = buildAcceptedEvent({
                            uid: ics_uid,
                            start,
                            end,
                            summary: ics_summary,
                            organizerEmail: ics_organizer || to?.[0],
                            attendeeEmail: from,
                            attendeeName: attendee_name,
                            location,
                        });

                        if (cal?.passwordEnc) {
                            await upsertEvent(
                                {
                                    principalUrl: cal.principalUrl,
                                    calendarUrl: cal.calendarUrl,
                                    username: cal.username,
                                    password: decrypt(cal.passwordEnc), // ← must be plaintext
                                    syncToken: cal.syncToken,
                                },
                                eventIcs
                            );
                        } else {
                            throw new Error("Missing CalDAV credentials");
                        }
                    }

                } catch (e) {
                    console.warn("[caldav] upsert accepted event failed", String(e));

                    // Fallback: ensure it's visible in your DB so the UI reflects acceptance
                    try {
                        const eventsCol = await col("cal_events");
                        await eventsCol.updateOne(
                            { tenantId, uid: ics_uid },
                            {
                                $set: {
                                    tenantId,
                                    uid: ics_uid,
                                    start: new Date(start),
                                    end: new Date(end),
                                    summary: ics_summary,
                                    location,
                                    organizer: ics_organizer,
                                    attendees: [{ email: from, name: attendee_name, partstat: "ACCEPTED" }],
                                    source: "local-accept",
                                    updatedAt: new Date(),
                                },
                                $setOnInsert: { createdAt: new Date() },
                            },
                            { upsert: true }
                        );
                    } catch (dbErr) {
                        console.warn("[db] fallback insert failed", String(dbErr));
                    }
                }

                await logs.updateOne(
                    { _id, tenantId },
                    { $set: { status: "executed", executedAt: new Date(), result: { ok: true, kind: "calendar_reply" } } }
                );
                await spendCreditsAndLog({
                    tenantId, cost: 5, action: "send_calendar_reply", threadId,
                    meta: { calendar: true }
                });
                return;
            }

            case "schedule_meeting": {
                const g = guardOrDeny("schedule_meeting");
                if (!g.ok) {
                    await logs.updateOne(
                        { _id, tenantId },
                        { $set: { status: "denied", deniedReason: g.reason, updatedAt: new Date() } }
                    );

                    await emit(tenantId, {
                        kind: "action_denied",
                        logId: _id.toString(),
                        reason: g.reason,
                        action: doc.action.type,
                    });

                    return;
                }

                // Pull the action payload from the decision log
                // Expecting: { attendeeEmail, durationMin, windowISO: string[], conference? }
                const a = (doc.action.payload ?? doc.action) as {
                    attendeeEmail: string;
                    durationMin: number;
                    windowISO: string[];
                    conference?: "meet" | "teams" | "zoom" | "jitsi";
                };

                const confidence: number | undefined = doc.confidence;
                const min = minThreshold(emp, "schedule_meeting", 0.92);
                if (!checkThreshold(confidence, min)) {
                    await logs.updateOne(
                        { _id, tenantId },
                        { $set: { status: "denied", deniedReason: "threshold", updatedAt: new Date() } }
                    );
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
                    await logs.updateOne(
                        { _id, tenantId },
                        { $set: { status: "failed", failReason: "no_slot", updatedAt: new Date() } }
                    );
                    return;
                }

                // Load tenant to get organiser email / defaults
                const tenants = await col("Tenant");
                const tenantDoc = await tenants.findOne({ _id: tenantId });
                const organizerEmail =
                    tenantDoc?.organizerEmail ||
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
                    await logs.updateOne(
                        { _id, tenantId },
                        { $set: { status: "failed", failReason: "no_caldav_connector", updatedAt: new Date() } }
                    );
                    return;
                }

                // Create event on CalDAV
                const href = await upsertEvent(
                    {
                        principalUrl: cal.principalUrl,
                        calendarUrl: cal.calendarUrl,
                        username: cal.username,
                        password: /* decrypt */ cal.passwordEnc,
                        syncToken: cal.syncToken,
                    },
                    ics
                );

                // Mark executed
                await logs.updateOne(
                    { _id, tenantId },
                    {
                        $set: {
                            status: "executed",
                            executedAt: new Date(),
                            result: { ok: true, kind: "calendar", href, slot },
                        },
                    }
                );

                await spendCreditsAndLog({
                    tenantId, cost: 10, action: "schedule_meeting",
                    meta: { href, slot }
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
                await logs.updateOne(
                    { _id, tenantId },
                    { $set: { status: "executed", executedAt: new Date(), result: payload } }
                );
                await emit(tenantId, { kind: "executed", logId, action: doc.action.type });
                return;
        }
    },
    { connection }
);
