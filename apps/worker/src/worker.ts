// apps/worker/src/worker.ts
import { subscribe, TOPIC_INGEST, IngestJob } from "./queue";
import { col } from "./db";
import { createImapClient } from "./runners/imapClient";
import type { MailMessage, MailThread, MailboxConnector, Draft, TenantSettings } from "@kadoo/types";
import { classifyMessage } from "./workers/classify";
import { decideAction } from "./workers/decide";
import { ensureFullBody } from "./workers/ensureBody";
import { resolveSpamMailbox } from "./util/resolveSpamMailbox";
import { handleInvite } from "./workers/handleInvite";
import {decisionsQueue} from "./queues";
import { getActiveEA, hasPermission } from "./util/employee";

type DraftDecision = {
    kind: "draft";
    subject?: string;
    text?: string;   // markdown/plain
    html?: string;   // optional html
    confidence?: number;
};

type NoneDecision = { kind: "none" };

type DecideActionResult = DraftDecision | NoneDecision;

const LOCK_TTL_MS = 5 * 60 * 1000;

console.log("[worker] ingest subscriber loaded");

function lockDocFilter(tenantId: string, threadId: string, uid: number, wantVersion: number) {
    return {
        tenantId, threadId, uid,
        $and: [
            { $or: [{ classifiedAt: null }, { classificationVersion: { $lt: wantVersion } }] },
            { $or: [{ processingLock: null }, { "processingLock.expiresAt": { $lt: new Date() } }] }
        ]
    };
}

subscribe<IngestJob>(TOPIC_INGEST, async ({ tenantId, threadId, uid }) => {
    const messages = await col<MailMessage>("MailMessage");
    const threads  = await col<MailThread>("MailThread");
    const settingsCol = await col<TenantSettings>("TenantSettings");
    const connectors = await col<MailboxConnector>("MailboxConnector");
    const now = new Date();
    const lock = { at: now, expiresAt: new Date(now.getTime() + LOCK_TTL_MS) };

    const thread = await threads.findOne({ _id: threadId, tenantId });
    const threadSubject = thread?.subject || "(no subject)";

    console.log(`[worker] locking`, { tenantId, threadId, uid });

    // try to acquire lock
    const wantVersion = 1;

    const updated = await messages.findOneAndUpdate(
        lockDocFilter(tenantId, threadId, uid, wantVersion),
        { $set: { processingLock: { at: now, expiresAt: new Date(now.getTime() + LOCK_TTL_MS) } } },
        { returnDocument: "after" }
    );

    // Support either ModifyResult<T>.value or direct doc-or-null
    const lockedDoc =
        (updated as any)?.value !== undefined ? (updated as any).value as MailMessage | null
            : (updated as MailMessage | null);

    if (!lockedDoc) {
        // already processed or currently locked
        console.log(`[worker] lock miss (already processing or processed)`, { threadId, uid });
        return;
    }
    console.log(`[worker] lock acquired`, { threadId, uid });

    let msg = await messages.findOne({ tenantId, threadId, uid });
    if (!msg) return;

    const ea = await getActiveEA(tenantId); // util returns EA even if disabled
    if (!ea?.enabled) {
        console.log("[worker] EA disabled (or missing) — skipping ingest for message", { threadId, uid });

        // IMPORTANT: clear the lock you just set, otherwise it holds until TTL
        await messages.updateOne(
            { tenantId, threadId, uid },
            { $unset: { processingLock: "" } }
        );

        // Optionally notify the UI:
        // await emit(tenantId, { kind: "ingest_skipped", reason: "ea_disabled", threadId, uid });

        return; // 👉 nothing else runs
    }

    console.log(`[worker] ensureFullBody.start`, { threadId, uid });
    msg = await ensureFullBody({ tenantId, threadId, uid }) || msg;
    console.log(`[worker] ensureFullBody.done`, { hasText: !!msg?.text, hasHtml: !!msg?.html });

    const folder = (msg as any).folder || "INBOX";

    const settings = (await settingsCol.findOne({ tenantId })) || {
        tenantId, autoDraft: true, autoSend: false, moveSpam: true
    } as TenantSettings;

    // 1) classify
    console.log(`[worker] classify.start`, { threadId, uid });
    const facts = await classifyMessage({ msg, tenantId, threadId, subject: threadSubject });
    console.log(`[worker] classify.done`, facts);
    await messages.updateOne(
        { tenantId, threadId, uid },
        { $set: { classifiedAt: new Date(), classificationVersion: wantVersion }, $setOnInsert: {}, $unset: { processingLock: "" } }
    );

    // thread aggregates
    const threadLabels = Array.from(new Set([...(facts.labels || [])]));
    await threads.updateOne(
        { _id: threadId, tenantId },
        { $set: { labels: threadLabels, lastClassifiedAt: new Date(), priority: facts.priority ?? 1 } }
    );

    // 2) apply label/move (server-side) if spam/newsletter etc.
    const isSpam = Boolean(facts.isSpam) || (facts.labels || []).includes("spam");
    if (isSpam && settings.moveSpam) {
        const source = (msg as any).folder || "INBOX";
        console.log(`[worker] spam.move.start`, { from: source });

        const conn = await connectors.findOne({ tenantId, type: "imap" });
        if (conn?.imap) {
            const client = await createImapClient(conn);
            try {
                // MUST open source folder to use UID-based ops
                await client.mailboxOpen(source);

                const dest = await resolveSpamMailbox(client); // e.g. "[Gmail]/Spam", "Junk", etc.
                console.log(`[worker] spam.resolve`, { dest: dest || "(none)" });

                if (dest) {
                    try {
                        await client.messageMove(String(uid), dest, { uid: true } as any);
                        // Reflect move in DB
                        await messages.updateOne(
                            { tenantId, threadId, uid },
                            { $set: { folder: dest }, $addToSet: { labels: "spam" } }
                        );
                        await threads.updateOne(
                            { _id: threadId, tenantId },
                            { $set: { folder: dest, lastUid: uid }, $addToSet: { labels: "spam" } }
                        );
                        console.log(`[worker] spam.move.ok`, { uid, dest });
                    } catch (e) {
                        console.warn(`[worker] spam.move.failed, flagging as \\Junk`, e);
                        await client.messageFlagsAdd(String(uid), ["\\Junk"], { uid: true } as any);
                        await messages.updateOne(
                            { tenantId, threadId, uid },
                            { $addToSet: { labels: "spam" } }
                        );
                        // keep folder as-is if we didn’t actually move
                    }
                } else {
                    console.warn(`[worker] no spam mailbox found, flagging as \\Junk`);
                    await client.messageFlagsAdd(String(uid), ["\\Junk"], { uid: true } as any);
                    await messages.updateOne(
                        { tenantId, threadId, uid },
                        { $addToSet: { labels: "spam" } }
                    );
                }
            } finally {
                try { await client.logout(); } catch {}
            }
        }

        console.log(`[worker] spam.move.done`);
        return;
    }

    // Detect a calendar invite via attachments + label
    const atts: any[] = Array.isArray((msg as any).attachments) ? (msg as any).attachments : [];
    const hasIcs = atts.some(a => String(a.contentType || "").toLowerCase().includes("text/calendar"));
    const isCalendar = hasIcs || (facts.labels || []).includes("calendar");

    if (isCalendar) {
        // Prefer the first ICS attachment
        const icsAttachment = atts.find(a => String(a.contentType || "").toLowerCase().includes("text/calendar"));
        let ics: string | undefined =
            icsAttachment?.content
                ? (Buffer.isBuffer(icsAttachment.content)
                    ? icsAttachment.content.toString("utf8")
                    : String(icsAttachment.content))
                : undefined;

        // Fallback: ICS captured by ensureFullBody via simpleParser
        if (!ics && (msg as any).calendarIcs) {
            ics = String((msg as any).calendarIcs);
        }

        // If we still don't have ICS, don't invoke the invite handler
        if (!ics) {
            console.warn("[worker] calendar email detected but no ICS found; skipping invite handler", {
                threadId, uid
            });
            return;
        }

        // Load policy (or default)
        const policies = await col<any>("TenantPolicy");
        const policy =
            (await policies.findOne({ tenantId })) ||
            { workingHours: { start: "09:00", end: "17:30", days: [1,2,3,4,5] }, buffers: { before: 10, after: 10 } };

        // Ensure date is string | number (avoid TS2322)
        const safeDate =
            typeof msg.date === "string" || typeof msg.date === "number"
                ? msg.date
                : (msg.date instanceof Date ? msg.date.toISOString() : undefined);

        console.log("[worker] invite.handle.start", { threadId, uid, hasIcs: !!ics });

        const decision = await handleInvite({
            tenantId,
            threadId,
            uid,
            ics,
            msg: { subject: threadSubject, from: msg.from, date: safeDate },
            policy,
            tz: "Europe/London",
        });

        console.log("[worker] invite.handle.done", decision);
        return; // Skip generic reply flow
    }

    // 3) decision (reply/no-op)
    console.log(`[worker] decide.start`);
    const decision = decideAction({
        msg: { ...msg, ...facts },
        subject: threadSubject,
        settings,
    }) as DecideActionResult;
    console.log(`[worker] decide.done`, decision);

    if (decision.kind === "draft") {
        const ea = await getActiveEA(tenantId);

        // 1) EA disabled → ignore
        if (!ea?.enabled) {
            // optional: await emit(tenantId, { kind: "action_denied", reason: "ea_disabled", action: "create_draft_reply", threadId });
            return;
        }

        // 2) EA enabled but cannot send → create PENDING approval decision (no IMAP append)
        if (!hasPermission(ea, "send_reply")) {
            await (await col("DecisionLog")).insertOne({
                tenantId,
                createdAt: new Date(),
                status: "pending",
                requiresApproval: true,
                confidence: decision.confidence ?? 0.9,
                reason: "permission_denied",
                action: {
                    type: "create_draft_reply",
                    payload: {
                        threadId,
                        to: [msg.from].filter(Boolean),
                        subject: decision.subject ?? threadSubject,
                        body_md: decision.text ?? "Thanks for your message.",
                        body_html: decision.html,
                    },
                },
                context: { labels: facts.labels, priority: facts.priority },
            });
            return;
        }

        // 3) EA enabled + permission OK → push to decisions (it will auto-exec or remain pending)
        await decisionsQueue.add(
            "plan",
            {
                tenantId,
                threadId,
                decision: {
                    actionType: "send_reply",
                    confidence: decision.confidence ?? 0.9,
                    payload: {
                        to: [msg.from].filter(Boolean),
                        subject: decision.subject ?? threadSubject,
                        body_md: decision.text ?? "Thanks for your message.",
                        body_html: decision.html,
                    },
                },
            },
            { removeOnComplete: true, removeOnFail: 50 }
        );

        return;
    }


    // if decision.kind === 'none' do nothing
});
