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

type DownloadResult = {
    // imapflow returns a stream/buffer-like "content"
    // we type it loosely to keep TS happy
    content: Buffer | NodeJS.ReadableStream | Uint8Array | string;
};

function collectAttachments(struct: any) {
    const out: Array<{ filename: string; contentType: string; size: number; partId: string }> = [];
    const walk = (n: any) => {
        if (!n) return;
        const isLeaf = Boolean(n.part);
        if (isLeaf) {
            const disp = String(n.disposition || "").toUpperCase();
            const fn = n?.dispositionParameters?.filename || n?.parameters?.name;
            const ct = `${n.type}/${n.subtype}`.toLowerCase();
            // Treat inline text/calendar as an attachment-like thing so we can find it later
            if (disp.includes("ATTACHMENT") || fn || ct === "text/calendar") {
                out.push({
                    filename: String(fn || (ct === "text/calendar" ? "invite.ics" : "attachment")),
                    contentType: ct,
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

function toBuffer(maybe: any): Promise<Buffer> {
    if (!maybe) return Promise.resolve(Buffer.alloc(0));
    if (Buffer.isBuffer(maybe)) return Promise.resolve(maybe);
    return new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        (maybe as NodeJS.ReadableStream)
            .on("data", (c) => chunks.push(Buffer.from(c)))
            .on("end", () => resolve(Buffer.concat(chunks)))
            .on("error", reject);
    });
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    let t: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, rej) => {
        t = setTimeout(() => rej(new Error(`[ensureFullBody] timeout ${ms}ms: ${label}`)), ms);
    });
    try {
        // @ts-ignore – Promise.race types
        return await Promise.race([p, timeout]);
    } finally {
        if (t) clearTimeout(t);
    }
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
        const openOne = async (paths: string[]) => {
            for (const p of paths) {
                try { await client.mailboxOpen(p, { readOnly: true }); return p; } catch {}
            }
            return null;
        };

        const recordedFolder = (doc as any).folder || "INBOX";
        let opened = await openOne([recordedFolder]);
        if (!opened) {
            // try a few common ones
            opened = await openOne(["INBOX", "[Gmail]/Spam", "Spam", "Junk", "INBOX.Junk"]);
        }
        if (!opened) return doc; // nowhere to search

        const m: any = await withTimeout(
            (client as any).fetchOne(uid, { source: true, bodyStructure: true }, { uid: true }),
            20_000,
            `fetchOne uid=${uid} in ${opened}`
        );
        if (!m || !m.source) return doc;

        const sourceBuf = await withTimeout(
            toBuffer(m.source),
            10_000,
            `read source stream uid=${uid}`
        ).catch(() => Buffer.alloc(0));

        if (!sourceBuf.length) return doc;

        const bodyStructure: any | null = m.bodyStructure ?? null;

        const parsed = await withTimeout(
            simpleParser(sourceBuf),
            15_000,
            `simpleParser uid=${uid}`
        );

        // Prefer HTML, then textAsHtml, then text
        const html =
            (typeof parsed.html === "string" ? parsed.html : "") ||
            (typeof (parsed as any).textAsHtml === "string" ? (parsed as any).textAsHtml : "");
        const text = typeof parsed.text === "string" ? parsed.text : "";

        // Attachment metadata from BODYSTRUCTURE
        const attachments = bodyStructure
            ? collectAttachments(bodyStructure)
            : (doc.attachments || []);

        // Capture inline ICS if present
        let calendarIcs: string | undefined;
        if (Array.isArray((parsed as any).attachments)) {
            const cal = (parsed as any).attachments.find((a: any) =>
                String(a.contentType || "").toLowerCase().includes("text/calendar")
            );
            if (cal?.content) {
                calendarIcs = (Buffer.isBuffer(cal.content) ? cal.content : Buffer.from(String(cal.content))).toString("utf8");
            }
        }

        await messages.updateOne(
            { tenantId, threadId, uid },
            {
                $set: {
                    html: html || undefined,
                    text: text || undefined,
                    attachments,
                    bodyFetchedAt: new Date(),
                    ...(calendarIcs ? { calendarIcs } : {}),
                },
            }
        );

        return await messages.findOne({ tenantId, threadId, uid });
    } catch (e) {
        console.warn("[ensureFullBody] failed (non-fatal)", { threadId, uid, err: String(e) });
        return doc; // don’t block the pipeline
    } finally {
        try { await client.logout(); } catch {}
    }
}
