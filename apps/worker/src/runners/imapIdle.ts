// apps/worker/src/runners/imapIdle.ts
import { ImapFlow } from "imapflow";
import { col } from "../db";
import type { MailboxConnector, MailThread, MailMessage } from "@kadoo/types";
import { getCursor, setCursor } from "./imapCursor";
import { publish, TOPIC_INGEST } from "../queue";

function toUtf8Snippet(content: unknown, max = 20_000): string {
    if (!content) return "";
    if (typeof content === "string") return content.slice(0, max);
    if (typeof Buffer !== "undefined" && (content as any).byteLength !== undefined) {
        const buf = Buffer.isBuffer(content) ? (content as Buffer) : Buffer.from(content as Uint8Array);
        return buf.toString("utf8").slice(0, max);
    }
    try { return String(content).slice(0, max); } catch { return ""; }
}

const running = new Set<string>();

export async function runImapIdle(connector: MailboxConnector, client: ImapFlow) {
    if (running.has(connector._id)) {
        console.log("[imap] loop already running for", connector._id);
        return;
    }
    running.add(connector._id);

    const messagesCol = await col<MailMessage>("MailMessage");
    const threadsCol  = await col<MailThread>("MailThread");

    let backoffMs = 1000;

    async function openInbox() {
        await client.mailboxOpen("INBOX", { readOnly: true });
        const mb = client.mailbox;
        if (!mb) throw new Error("mailbox not open");
        console.log("[imap] INBOX opened", {
            exists: mb.exists,
            uidValidity: mb.uidValidity ? mb.uidValidity.toString() : ""
        });
    }

    async function initialSync() {
        const mb = client.mailbox;
        if (!mb) return;

        const uidValidity = Number(mb.uidValidity);
        const cursor = await getCursor(connector._id);
        const lastUid = cursor?.lastUid ?? 0;

        // last 14 days
        const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

        // 1) Search by date, but ask for UIDs explicitly
        const allUids = (await client.search({ since }, { uid: true })) as number[];
        if (!allUids || allUids.length === 0) {
            await setCursor(connector._id, connector.tenantId, { uidValidity, lastUid });
            return;
        }

        // Only UIDs above the saved cursor
        const newUids = allUids.filter(u => u > lastUid).sort((a, b) => a - b);
        if (newUids.length === 0) return;

        // --- use array chunks, not a seqset string ---
        const chunk = <T,>(arr: T[], size: number) =>
            Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
                arr.slice(i * size, i * size + size)
            );

        let maxSeenUid = lastUid;

        for (const uid of newUids) {
            try {
                // ✅ third arg is options → uid mode enabled
                const it = await client.fetchOne(uid, { envelope: true }, { uid: true });
                if (it === false) continue;

                const msg = it as any;
                const date      = msg.envelope?.date ?? new Date();
                const subject   = msg.envelope?.subject ?? "(no subject)";
                const from      = msg.envelope?.from?.[0]?.address ?? "";
                const to        = (msg.envelope?.to ?? []).map((a: any) => a.address!).filter(Boolean);
                const messageId = msg.envelope?.messageId ?? String(uid);
                const threadId  = `${connector._id}:${messageId}`;

                await threadsCol.updateOne(
                    { _id: threadId },
                    {
                        $setOnInsert: {
                            _id: threadId,
                            tenantId: connector.tenantId,
                            connectorId: connector._id,
                            subject,
                            participants: [from, ...to],
                            status: "awaiting_us",
                            facts: [],
                            lastMessageIds: [],
                            createdAt: date,
                            folder: "INBOX",
                        },
                        $set: { lastTs: date, lastUid: uid, lastMsgId: messageId },
                        $addToSet: { messageUids: uid },
                        $inc: { unread: 1 },
                    },
                    { upsert: true }
                );

                const dl = await (client as any).download(String(uid), { uid: true }).catch(() => null as any);
                const text = toUtf8Snippet(dl?.content);

                await messagesCol.updateOne(
                    { _id: `${threadId}:${uid}` },
                    {
                        $set: {
                            _id: `${threadId}:${uid}`,
                            tenantId: connector.tenantId,
                            threadId,
                            msgId: messageId,
                            uid,
                            uidValidity: Number(mb.uidValidity ?? 0),
                            from, to, cc: [],
                            date, text,
                            folder: "INBOX",
                        },
                    },
                    { upsert: true }
                );

                await publish(TOPIC_INGEST, { tenantId: connector.tenantId, threadId, uid });
                if (uid > maxSeenUid) maxSeenUid = uid;

            } catch (e) {
                console.warn(`[imapIdle] fetchOne failed for uid=${uid}`, e);
                continue;
            }
        }

        if (maxSeenUid > lastUid) {
            await setCursor(connector._id, connector.tenantId, {
                uidValidity: Number(mb.uidValidity ?? 0),
                lastUid: maxSeenUid
            });
        }
    }

    async function onExists() {
        const mb = client.mailbox;
        if (!mb) return;

        const cur = await getCursor(connector._id);
        let lastUid = cur?.lastUid ?? 0;

        const latestSeq = mb.exists;
        if (!latestSeq || typeof latestSeq !== "number") return;

        const lock = await client.getMailboxLock("INBOX");
        try {
            const it = await client.fetchOne(latestSeq, { envelope: true });
            if (it === false) return;
            const m = it as any;
            if (!m.uid) return;
            if (m.uid <= lastUid) return;

            const date      = m.envelope?.date ?? new Date();
            const subject   = m.envelope?.subject ?? "(no subject)";
            const from      = m.envelope?.from?.[0]?.address ?? "";
            const to        = (m.envelope?.to ?? []).map((a: any) => a.address!).filter(Boolean);
            const messageId = m.envelope?.messageId ?? String(m.uid);
            const threadId  = `${connector._id}:${messageId}`;

            await threadsCol.updateOne(
                { _id: threadId },
                {
                    $setOnInsert: {
                        _id: threadId,
                        tenantId: connector.tenantId,
                        connectorId: connector._id,
                        subject,
                        participants: [from, ...to],
                        status: "awaiting_us",
                        facts: [],
                        lastMessageIds: [],
                        createdAt: date,
                        folder: "INBOX",
                    },
                    $set: { lastTs: date, unread: 1 },
                },
                { upsert: true }
            );

            const dl = await (client as any).download(String(m.uid), { uid: true }).catch(() => null as any);
            const text = toUtf8Snippet(dl?.content);

            await messagesCol.updateOne(
                { _id: `${threadId}:${m.uid}` },
                {
                    $set: {
                        _id: `${threadId}:${m.uid}`,
                        tenantId: connector.tenantId,
                        threadId,
                        msgId: messageId,
                        uid: m.uid,
                        from,
                        to,
                        cc: [],
                        date,
                        text,
                        folder: "INBOX",
                    },
                },
                { upsert: true }
            );

            try {
                await publish(TOPIC_INGEST, { tenantId: connector.tenantId, threadId, uid: m.uid }, {
                    jobId: `${connector.tenantId}:${threadId}:${m.uid}`
                });
                await setCursor(connector._id, connector.tenantId, { uidValidity: Number(mb.uidValidity), lastUid: m.uid });
                console.log(`[imapIdle] queued ingest`, { threadId, uid: m.uid });
            } catch (err) {
                console.error(`[imapIdle] publish failed`, err);
            }
        } finally {
            lock.release();
        }
    }

    while (true) {
        try {
            await openInbox();
            await initialSync();

            // attach exists handler once per connection
            client.on("exists", onExists);

            // enter IDLE and stay there; server may drop it periodically
            // we re-await idle again in the loop to re-enter
            // Use a finite timeout to periodically wake up and verify state
            while (client.usable) {
                const watchdog = setTimeout(() => {
                    // Gently break IDLE so we can re-enter (and keep connection fresh)
                    client.noop().catch(() => {});   // <- this ends the current idle()
                }, 15 * 60 * 1000);

                try {
                    await client.idle();             // <- no args
                } catch (err: any) {
                    clearTimeout(watchdog);
                    if (err?.code !== "NoConnection" && err?.code !== "Closed") throw err;
                    break; // let outer reconnect logic run
                }

                clearTimeout(watchdog);
                // loop re-enters idle()
            }

            // if we fall out because usable=false, let outer catch handle reconnect
            throw Object.assign(new Error("imap not usable"), { code: "NoConnection" });

        } catch (err: any) {
            // Treat socket closes/IDLE drops as normal reconnects
            if (err?.code === "NoConnection" || err?.code === "Closed") {
                // Clean up listeners to avoid duplicates on reconnect
                client.removeListener("exists", onExists);
                // short delay then reconnect
                await new Promise(r => setTimeout(r, backoffMs));
                backoffMs = Math.min(backoffMs * 2, 30_000);
                // the caller that owns `client` should reconnect or recreate it;
                // if you own it here, ensure you call client.connect() again
                try {
                    // try to re-open INBOX on same client; if it fails, outer infra should recreate client
                    await client.mailboxOpen("INBOX", { readOnly: true });
                    backoffMs = 1000; // reset backoff after a successful reopen
                    continue;         // go back to while(true) and re-idle
                } catch {
                    // break to let supervisor recreate the client instance cleanly
                    break;
                }
            }

            // Unexpected errors: log & break so a supervisor restarts the runner
            console.error("imap idle unexpected error", connector._id, err);
            client.removeListener("exists", onExists);
            break;
        }
    }

    running.delete(connector._id);
}
