// apps/worker/src/workers/ensureBody.ts
import { createImapClient } from "../runners/imapClient";
import { col } from "../db";
import type { MailMessage, MailboxConnector } from "@kadoo/types";
import { simpleParser } from "mailparser";

type EnsureArgs = {
    tenantId: string;
    threadId: string;
    uid: number;
    force?: boolean; // set true if you ever need to re-parse
};

function collectAttachments(struct: any) {
    const out: Array<{ filename: string; contentType: string; size: number; partId: string }> = [];
    const walk = (n: any) => {
        if (!n) return;
        const isLeaf = Boolean(n.part);
        if (isLeaf) {
            const disp = String(n.disposition || "").toUpperCase();
            const fn = n?.dispositionParameters?.filename || n?.parameters?.name;
            if (disp.includes("ATTACHMENT") || fn) {
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

export async function ensureFullBody({ tenantId, threadId, uid, force }: EnsureArgs) {
    const messages = await col<MailMessage>("MailMessage");
    const connectors = await col<MailboxConnector>("MailboxConnector");

    const doc = await messages.findOne({ tenantId, threadId, uid });
    if (!doc) return null;

    // If we already have a body and not forcing, return it as-is
    if (!force && (doc.text || doc.html)) return doc;

    const conn = await connectors.findOne({ tenantId, type: "imap" });
    if (!conn?.imap) return doc;

    const client = await createImapClient(conn);
    try {
        // Try the folder we think it's in; if that fails, we'll search by Message-ID
        const folder = (doc as any).folder || "INBOX";
        await client.mailboxOpen(folder, { readOnly: true }).catch(() => { /* will try fallback */ });

        // Prefer fetching both SOURCE and BODYSTRUCTURE so we can also persist attachments metadata
        let sourceBuf: Buffer | null = null;
        let bodyStruct: any | null = null;

        // Try by UID first
        try {
            for await (const it of client.fetch(String(uid), { uid: true, source: true, bodyStructure: true })) {
                const src = (it as any)?.source;
                bodyStruct = (it as any)?.bodyStructure || null;

                if (src) {
                    sourceBuf = Buffer.isBuffer(src)
                        ? src
                        : await new Promise<Buffer>((resolve, reject) => {
                            const chunks: Buffer[] = [];
                            (src as NodeJS.ReadableStream)
                                .on("data", (c) => chunks.push(Buffer.from(c)))
                                .on("end", () => resolve(Buffer.concat(chunks)))
                                .on("error", reject);
                        });
                }
                break;
            }
        } catch {
            // swallow; we’ll try fallback below
        }

        // Fallback: if we didn’t get the source (maybe moved folders), search by Message-ID header
        if (!sourceBuf && doc.msgId) {
            try {
                const hits = await client.search({ header: { "message-id": doc.msgId } });
                if (Array.isArray(hits) && hits.length) {
                    const hitUid = String(hits[hits.length - 1]);
                    // We also want bodyStructure here if possible
                    for await (const it of client.fetch(hitUid, { uid: true, source: true, bodyStructure: true })) {
                        const src = (it as any)?.source;
                        bodyStruct = bodyStruct || (it as any)?.bodyStructure || null;

                        if (src) {
                            sourceBuf = Buffer.isBuffer(src)
                                ? src
                                : await new Promise<Buffer>((resolve, reject) => {
                                    const chunks: Buffer[] = [];
                                    (src as NodeJS.ReadableStream)
                                        .on("data", (c) => chunks.push(Buffer.from(c)))
                                        .on("end", () => resolve(Buffer.concat(chunks)))
                                        .on("error", reject);
                                });
                        }
                        break;
                    }
                }
            } catch {
                /* ignore */
            }
        }

        if (!sourceBuf) return doc; // nothing we can do

        const parsed = await simpleParser(sourceBuf);

        const html =
            (typeof parsed.html === "string" ? parsed.html : "") ||
            (typeof (parsed as any).textAsHtml === "string" ? (parsed as any).textAsHtml : "");
        const text = typeof parsed.text === "string" ? parsed.text : "";

        const attachments = bodyStruct ? collectAttachments(bodyStruct) : (doc.attachments || []);

        await messages.updateOne(
            { tenantId, threadId, uid },
            {
                $set: {
                    html: html || undefined,
                    text: text || undefined,
                    attachments,
                    bodyFetchedAt: new Date(),
                },
            }
        );

        // return the freshest doc
        return await messages.findOne({ tenantId, threadId, uid });
    } finally {
        try { await client.logout(); } catch {}
    }
}
