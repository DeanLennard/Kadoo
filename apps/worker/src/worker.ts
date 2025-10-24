// apps/worker/src/worker.ts
import { subscribe, TOPIC_INGEST, IngestJob } from "./queue";
import { col } from "./db";
import { createImapClient } from "./runners/imapClient";
import type { MailMessage, MailThread, MailboxConnector, Draft, TenantSettings } from "@kadoo/types";
import { classifyMessage } from "./workers/classify";
import { decideAction } from "./workers/decide";
import { generateDraft } from "./workers/generateDraft";
import { ensureFullBody } from "./workers/ensureBody";
import {resolveSpamMailbox} from "./util/resolveSpamMailbox";
import { appendImapDraft } from "./workers/appendImapDraft";

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
                            { $set: { folder: dest }, $addToSet: { labels: "spam" } }
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

    // 3) decision (reply/no-op)
    console.log(`[worker] decide.start`);
    const decision = decideAction({ msg: { ...msg, ...facts }, subject: threadSubject, settings });
    console.log(`[worker] decide.done`, decision);

    if (decision.kind === "draft") {
        console.log(`[worker] generateDraft.start`);
        const draft = await generateDraft({
            tenantId, threadId, uidRef: uid,
            msg: { ...msg, ...facts },
            subject: threadSubject,
            settings
        });

        const drafts = await col<Draft>("Draft");
        await drafts.insertOne(draft);
        await messages.updateOne({ tenantId, threadId, uid }, { $set: { autoDraftId: draft._id } });
        console.log(`[worker] generateDraft.inserted`, { draftId: draft._id });

        const imapInfo = await appendImapDraft({ tenantId, threadId, uidRef: uid, draft });
        if (imapInfo) {
            console.log("[worker] imap draft appended", imapInfo);
        }

        // (Optional) store to IMAP Drafts so clients can see it
        // appendDraftToImap(conn, draft.html/text)

        // TODO: notify user in-app (badge or inbox “Drafts ready”)
    }

    // if decision.kind === 'none' do nothing
});
