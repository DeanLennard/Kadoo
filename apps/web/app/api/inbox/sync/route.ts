// apps/web/app/api/inbox/sync/route.ts
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { col } from "@/lib/db";
import type { MailboxConnector, MailMessage, MailThread } from "@kadoo/types";
import { createImapClient } from "@/../../apps/worker/src/runners/imapClient";
import { publish, TOPIC_INGEST } from "@/../../apps/worker/src/queue";

function collectAttachments(node: any) {
    const out: Array<{ filename: string; contentType: string; size: number; partId: string }> = [];

    const norm = (s: any) => String(s ?? "").trim();

    const walk = (n: any) => {
        if (!n) return;

        const isLeaf = Boolean(n.part); // leaf parts have .part like "2.1"
        if (isLeaf) {
            const disp = String(n.disposition || "").toUpperCase();
            const hasFilename = n?.dispositionParameters?.filename || n?.parameters?.name;
            const looksAttachment = disp.includes("ATTACHMENT") || hasFilename;

            if (looksAttachment) {
                out.push({
                    filename: norm(n?.dispositionParameters?.filename || n?.parameters?.name || "attachment"),
                    contentType: `${n.type}/${n.subtype}`.toLowerCase(),
                    size: Number(n.size || 0),
                    partId: String(n.part),             // <-- store ONLY the string part id
                });
            }
        }

        (n.childNodes || []).forEach(walk);
    };

    walk(node);
    return out;
}

export async function POST(req: Request) {
    const { tenantId } = await requireSession();
    const { folder } = await req.json();
    const box = (typeof folder === "string" && folder.trim()) || "INBOX";

    const connectors = await col<MailboxConnector>("MailboxConnector");
    const conn = await connectors.findOne({ tenantId, type: "imap" });
    if (!conn?.imap) return NextResponse.json({ error: "No IMAP connector" }, { status: 400 });

    const threadsCol = await col<MailThread>("MailThread");
    const msgsCol    = await col<MailMessage>("MailMessage");

    const client = await createImapClient(conn);
    try {
        await client.mailboxOpen(box, { readOnly: true });

        // last 14 days
        const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

        // Search (can return false)
        const searchRes = await client.search({ since }).catch(() => []);
        const uids: number[] = Array.isArray(searchRes) ? searchRes : [];
        if (uids.length === 0) return NextResponse.json({ ok: true, count: 0 });

        // Fetch lightweight data — pass the uid array directly
        for await (const msg of client.fetch(uids, { envelope: true, flags: true, bodyStructure: true })) {
            if (!msg?.uid) continue;

            const env = msg.envelope || {};
            const date = env.date ? new Date(env.date) : new Date();
            const subject = env.subject || "(no subject)";
            const from = env.from?.[0]?.address || "";
            const to = (env.to || []).map((a: any) => a.address).filter(Boolean);
            const messageId = env.messageId || String(msg.uid);
            const threadId = `${conn._id}:${messageId}`;

            const flagsSet: Set<string> | undefined = (msg as any).flags;
            const seen = flagsSet?.has("\\Seen") ?? false;

            const bs: any = (msg as any).bodyStructure;
            const attachments =
                Array.isArray(bs?.childNodes)
                    ? collectAttachments(bs)
                    : [];

            // Thread upsert
            await threadsCol.updateOne(
                { _id: threadId },
                {
                    $setOnInsert: {
                        _id: threadId,
                        tenantId,
                        connectorId: conn._id,
                        subject,
                        participants: [from, ...to],
                        status: "awaiting_us",
                        facts: [],
                        lastMessageIds: [],
                        createdAt: date,
                    },
                    $set: { lastTs: date, folder: box },
                    $inc: { unread: seen ? 0 : 1 },
                },
                { upsert: true }
            );

            // Message upsert (no bodies)
            const up = await msgsCol.updateOne(
                { _id: `${threadId}:${msg.uid}` },
                {
                    $set: {
                        _id: `${threadId}:${msg.uid}`,
                        tenantId,
                        threadId,
                        msgId: messageId,
                        uid: msg.uid,
                        from, to, cc: [],
                        date,
                        flags: Array.from(flagsSet ?? []), // store as array
                        folder: box,
                        attachments,
                        classificationVersion: 1,
                    },
                    $setOnInsert: {
                        hasLargeAttachments: false,
                        classifiedAt: null,
                        processingLock: null,
                    },
                },
                { upsert: true }
            );

            if (up.upsertedCount === 1) {
                await publish(TOPIC_INGEST, { tenantId, threadId, uid: msg.uid });
            }
        }

        return NextResponse.json({ ok: true, count: uids.length });
    } finally {
        try { await client.logout(); } catch {}
    }
}
