// apps/web/app/api/inbox/fetch-message/route.ts
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { col } from "@/lib/db";
import type { MailMessage, MailboxConnector, MailThread } from "@kadoo/types";
import { createImapClient } from "@/../../apps/worker/src/runners/imapClient";
import { simpleParser } from "mailparser";
import type { Readable } from "stream";

function collectAttachments(struct: any) {
    const out: Array<{ filename: string; contentType: string; size: number; partId: string }> = [];

    const walk = (n: any) => {
        if (!n) return;
        const isLeaf = Boolean(n.part); // leaf parts have "1", "2.1" etc
        if (isLeaf) {
            const disp = String(n.disposition || "").toUpperCase();
            const fn = n?.dispositionParameters?.filename || n?.parameters?.name;
            const looksAttachment = disp.includes("ATTACHMENT") || !!fn;
            if (looksAttachment) {
                out.push({
                    filename: String(fn || "attachment"),
                    contentType: `${n.type}/${n.subtype}`.toLowerCase(),
                    size: Number(n.size || 0),
                    partId: String(n.part),
                });
            }
        }
        (n.childNodes || []).forEach(walk);
    };

    walk(struct);
    return out;
}

export async function POST(req: Request) {
    const { tenantId } = await requireSession();
    const { threadId, uid, folder } = await req.json();

    if (!threadId || typeof uid !== "number") {
        return NextResponse.json({ error: "Bad input" }, { status: 400 });
    }

    const messages = await col<MailMessage>("MailMessage");
    const dbMsg = await messages.findOne({ tenantId, threadId, uid });
    if (!dbMsg) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const box = (folder && String(folder)) || dbMsg.folder || "INBOX";

    const connectors = await col<MailboxConnector>("MailboxConnector");
    const conn = await connectors.findOne({ tenantId, type: "imap" });
    if (!conn?.imap) return NextResponse.json({ error: "No IMAP connector" }, { status: 400 });

    const client = await createImapClient(conn);

    async function bufferFromSource(source: Buffer | Readable): Promise<Buffer> {
        if (Buffer.isBuffer(source)) return source;
        return new Promise<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = [];
            (source as Readable)
                .on("data", (c) => chunks.push(Buffer.from(c)))
                .on("end", () => resolve(Buffer.concat(chunks)))
                .on("error", reject);
        });
    }

    try {
        await client.mailboxOpen(box); // read-write

        let rawBuf: Buffer | null = null;
        let seenUid: string | undefined; // <-- declare in outer scope so we can use it later
        let bodyStruct: any | null = null;

        // --- Attempt A: fetch by UID directly ---
        try {
            for await (const it of client.fetch(String(uid), { uid: true, source: true, bodyStructure: true })) {
                bodyStruct = (it as any).bodyStructure || null;
                const src = (it as any)?.source;
                if (src) {
                    rawBuf = Buffer.isBuffer(src)
                        ? src
                        : await bufferFromSource(src as any); // same helper as before
                }
                break;
            }
        } catch {
            /* fall back */
        }

        // --- Attempt B: search by Message-ID then fetch that UID ---
        if (!rawBuf) {
            const msgId = dbMsg.msgId || "";
            if (msgId) {
                const hits = await client.search({ header: { "message-id": msgId } }).catch(() => false as const);
                if (Array.isArray(hits) && hits.length > 0) {
                    const hitUid = String(hits[hits.length - 1]);
                    for await (const it of client.fetch(hitUid, { uid: true, source: true, bodyStructure: true } as any)) {
                        bodyStruct = (it as any).bodyStructure || bodyStruct; // <-- capture it here too
                        const src = (it as any)?.source as Buffer | Readable | undefined;
                        if (!src) continue;
                        rawBuf = await bufferFromSource(src);
                        seenUid = hitUid;
                        break;
                    }
                }
            }
        }

        if (!rawBuf) {
            // nothing we can fetch; don’t error the UI
            return NextResponse.json({ ok: true });
        }

        if (!bodyStruct) {
            for await (const it of client.fetch(String(seenUid ?? uid), { uid: true, bodyStructure: true })) {
                bodyStruct = (it as any).bodyStructure || null;
                break;
            }
        }

        const parsed = await simpleParser(rawBuf);

        const html =
            (typeof parsed.html === "string" ? parsed.html : "") ||
            (typeof (parsed as any).textAsHtml === "string" ? (parsed as any).textAsHtml : "");
        const text = typeof parsed.text === "string" ? parsed.text : "";

        const attachments = bodyStruct ? collectAttachments(bodyStruct) : [];

        // Mark seen on server by the UID we actually used
        try {
            if (seenUid) {
                await client.messageFlagsAdd(seenUid, ["\\Seen"], { uid: true } as any);
            }
        } catch {}

        // Local update
        const alreadySeen = Array.isArray(dbMsg.flags) && dbMsg.flags.includes("\\Seen");
        const newFlags = Array.from(new Set([...(dbMsg.flags ?? []), "\\Seen"]));

        await messages.updateOne(
            { tenantId, threadId, uid },
            { $set: { html: html || undefined, text: text || undefined, flags: newFlags, attachments } }
        );

        if (!alreadySeen) {
            const threads = await col<MailThread>("MailThread");
            await threads.updateOne({ _id: threadId, tenantId, unread: { $gt: 0 } }, { $inc: { unread: -1 } });
        }

        return NextResponse.json({ ok: true });
    } finally {
        try {
            await client.logout();
        } catch {}
    }
}
