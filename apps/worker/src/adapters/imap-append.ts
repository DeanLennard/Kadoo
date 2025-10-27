// apps/worker/src/adapters/imap-append.ts
import { ImapFlow } from "imapflow";
import type { MailboxConnector } from "@kadoo/types";
import { simpleParser } from "mailparser";

export async function appendDraft(
    conn: MailboxConnector,
    raw: Buffer | string,
    mailbox: string = "Drafts",
    flags: string[] = ["\\Draft"]
) {
    if (!conn.imap) throw new Error("No IMAP config");

    const client = new ImapFlow({
        host: conn.imap.host,
        port: conn.imap.port,
        secure: conn.imap.secure,
        auth: { user: conn.imap.user, pass: conn.imap.pass },
        tls: conn.imap.allowSelfSigned ? { rejectUnauthorized: false } : undefined,
        logger: false,
    });

    await client.connect();
    try {
        // If targeting Drafts, try common names; otherwise open the mailbox given.
        let target = mailbox;
        if (mailbox === "Drafts") {
            const candidates = ["Drafts", "INBOX.Drafts", "[Gmail]/Drafts"];
            for (const f of candidates) {
                try { await client.mailboxOpen(f, { readOnly: true }); target = f; break; } catch { /* try next */ }
            }
        }

        await client.mailboxOpen(target, { readOnly: false });
        await client.append(target, raw, flags);
    } finally {
        await client.logout();
    }
}

export async function appendToMailbox(
    conn: MailboxConnector,
    raw: Buffer | string,
    mailbox: string,
    flags: string[] = ["\\Seen"]
) {
    if (!conn.imap) throw new Error("No IMAP config");

    const client = new ImapFlow({
        host: conn.imap.host,
        port: conn.imap.port,
        secure: conn.imap.secure,
        auth: { user: conn.imap.user, pass: conn.imap.pass },
        tls: conn.imap.allowSelfSigned ? { rejectUnauthorized: false } : undefined,
    });

    await client.connect();
    try {
        await client.mailboxOpen(mailbox, { readOnly: false });
        await client.append(mailbox, raw, flags);
    } finally {
        await client.logout();
    }
}

export async function resolveSentMailbox(connCfg: MailboxConnector): Promise<string> {
    const client = new ImapFlow({
        host: connCfg.imap!.host,
        port: connCfg.imap!.port,
        secure: connCfg.imap!.secure,
        auth: { user: connCfg.imap!.user, pass: connCfg.imap!.pass },
        tls: connCfg.imap?.allowSelfSigned ? { rejectUnauthorized: false } : undefined,
    });

    await client.connect();
    try {
        const boxes = await client.list();
        // Special-use first
        const sent = boxes.find(b => (b.specialUse || "").toLowerCase() === "\\sent");
        if (sent) return sent.path;
        // Common fallbacks
        const candidates = ["Sent", "Sent Items", "Sent Mail", "[Gmail]/Sent Mail"];
        const found = boxes.find(b => candidates.includes(b.path));
        return found?.path || "Sent";
    } finally {
        await client.logout();
    }
}
