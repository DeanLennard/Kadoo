// apps/worker/src/adapters/imap-append.ts
import { ImapFlow } from "imapflow";
import type { MailboxConnector } from "@kadoo/types";

export async function appendDraft(conn: MailboxConnector, raw: Buffer | string) {
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
    // Common draft folder names; you can make this configurable later
    const candidateFolders = ["Drafts", "INBOX.Drafts", "[Gmail]/Drafts"];
    let drafts = "Drafts";
    for (const f of candidateFolders) {
        try { await client.mailboxOpen(f, { readOnly: true }); drafts = f; break; }
        catch { /* try next */ }
    }
    await client.mailboxOpen(drafts);
    await client.append(drafts, raw, ["\\Draft"]);
    await client.logout();
}
