// apps/worker/src/workers/ensureBody.ts
import { createImapClient } from "../runners/imapClient";
import { col } from "../db";
import type { MailMessage, MailboxConnector } from "@kadoo/types";
import { simpleParser } from "mailparser";

export async function ensureFullBody(args: {
    tenantId: string;
    threadId: string;
    uid: number;
}) {
    const { tenantId, threadId, uid } = args;
    const messages = await col<MailMessage>("MailMessage");
    const connectors = await col<MailboxConnector>("MailboxConnector");

    const doc = await messages.findOne({ tenantId, threadId, uid });
    if (!doc) return null;

    // If already have text or html, skip (idempotent)
    if (doc.text || doc.html) return doc;

    const conn = await connectors.findOne({ tenantId, type: "imap" });
    if (!conn?.imap) return doc;

    const client = await createImapClient(conn);
    try {
        const folder = (doc as any).folder || "INBOX";
        await client.mailboxOpen(folder, { readOnly: true });

        // Download full source by UID
        const dl = await (client as any).download(String(uid), { uid: true }).catch(() => null as any);
        if (!dl?.content) return doc;

        const buf = Buffer.isBuffer(dl.content)
            ? dl.content
            : await new Promise<Buffer>((resolve, reject) => {
                const chunks: Buffer[] = [];
                dl.content
                    .on("data", (c: Buffer) => chunks.push(Buffer.from(c)))
                    .on("end", () => resolve(Buffer.concat(chunks)))
                    .on("error", reject);
            });

        const parsed = await simpleParser(buf);

        const html =
            (typeof parsed.html === "string" ? parsed.html : "") ||
            (typeof (parsed as any).textAsHtml === "string" ? (parsed as any).textAsHtml : "");
        const text = typeof parsed.text === "string" ? parsed.text : "";

        // Optional: rebuild attachments from parsed or bodyStructure if you want richer metadata later
        await messages.updateOne(
            { tenantId, threadId, uid },
            { $set: { html: html || undefined, text: text || undefined } }
        );

        return await messages.findOne({ tenantId, threadId, uid });
    } finally {
        try { await client.logout(); } catch {}
    }
}
