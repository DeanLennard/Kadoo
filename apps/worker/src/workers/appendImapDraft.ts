// apps/worker/src/workers/appendImapDraft.ts
import { createImapClient } from "../runners/imapClient";
import type { MailboxConnector, MailMessage, Draft, TenantSettings } from "@kadoo/types";
import { col } from "../db";
import { resolveDraftsMailbox } from "../util/resolveDraftsMailbox";
import { buildRfc822 } from "../util/buildRfc822";

type AppendMode = "reply" | "new";

export async function appendImapDraft(args: {
    tenantId: string;
    threadId: string;
    uidRef: number;     // message we’re replying to (for mode:"reply")
    draft: Draft;       // generated draft body/subject
    mode?: AppendMode;  // "reply" | "new" (default: "reply")
    includeQuoted?: boolean; // include quoted original body for reply (default true)
}) {
    const { tenantId, threadId, uidRef, draft, mode = "reply", includeQuoted = true } = args;

    const connectors = await col<MailboxConnector>("MailboxConnector");
    const messages   = await col<MailMessage>("MailMessage");
    const settingsCol = await col<TenantSettings>("TenantSettings");

    const conn = await connectors.findOne({ tenantId, type: "imap" });
    if (!conn?.imap) return null;

    // Try to get a proper “From” identity
    // Prefer an explicit settings identity; otherwise IMAP auth user / userEmail
    const tenantSettings = await settingsCol.findOne({ tenantId }).catch(() => null as any);
    const senderName = tenantSettings?.senderName || tenantSettings?.company || "Team";
    // These fields depend on your connector schema – adapt if needed:
    const accountEmail =
        (conn as any).imap.userEmail ||
        (conn as any).imap.auth?.user ||
        (conn as any).imap.user ||
        "noreply@example.com";
    const fromIdentity = `${senderName} <${accountEmail}>`;

    // Fetch the parent message if we are replying
    const parent = mode === "reply"
        ? await messages.findOne({ tenantId, threadId, uid: uidRef })
        : null;

    // Addressing
    let to: string[] = [];
    if (mode === "reply" && parent) {
        const replyToArr = (parent as any).replyTo as string[] | undefined;
        const parentFrom = parent.from ? [parent.from] : [];
        to = (replyToArr && replyToArr.length ? replyToArr : parentFrom).filter(Boolean);
    } else {
        // “new” mode: leave To empty or use what your Draft contains if you add that later
        to = [];
    }

    // Subject
    const baseSubject = draft.subject || "";
    const subject =
        mode === "reply"
            ? (baseSubject.startsWith("Re:") ? baseSubject : `Re: ${baseSubject || "(no subject)"}`)
            : (baseSubject || "(no subject)");

    // Reply headers
    let inReplyTo: string | undefined;
    let references: string[] | undefined;

    if (mode === "reply" && parent) {
        // parent.msgId may be stored with <> or not; normalize to <...>
        const parentMsgId = parent.msgId?.startsWith("<") ? parent.msgId : parent.msgId ? `<${parent.msgId}>` : undefined;

        const parentRefs = (parent as any).references as string[] | undefined; // store this in ensureFullBody if you can
        inReplyTo = parentMsgId;
        references = [
            ...(parentRefs || []),
            ...(parentMsgId ? [parentMsgId] : []),
        ];
    }

    // Build a quoted version of the original for the reply
    function makeQuotedText(orig: string, hdrLine: string) {
        const body = (orig || "").replace(/\r?\n/g, "\n");
        const quoted = body.split("\n").map(l => `> ${l}`).join("\n");
        return `${hdrLine}\n${quoted}`;
    }
    function makeQuotedHtml(origHtml: string, hdrLine: string, origText: string) {
        const bodyHtml = (origHtml || "").trim();
        if (bodyHtml) {
            return `${hdrLine}<br><blockquote style="margin:0 0 0 .8em;border-left:3px solid #ccc;padding-left:.8em">${bodyHtml}</blockquote>`;
        }
        // if no HTML, fall back to text
        const safeText = (origText || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, "<br>");
        return `${hdrLine}<br><blockquote style="margin:0 0 0 .8em;border-left:3px solid #ccc;padding-left:.8em">${safeText}</blockquote>`;
    }

    let text = draft.text || "";
    let html = draft.html || "";

    if (mode === "reply" && parent && includeQuoted) {
        const dt = new Date(parent.date || Date.now());
        const hdrLineTxt = `On ${dt.toLocaleString()}, ${parent.from || "the sender"} wrote:`;
        const hdrLineHtml = `<div>On ${dt.toLocaleString()}, ${parent.from || "the sender"} wrote:</div>`;

        const quotedText = makeQuotedText(parent.text || "", hdrLineTxt);
        const quotedHtml = makeQuotedHtml(parent.html || "", hdrLineHtml, parent.text || "");

        // Append quoted content to our draft (simple style; tweak as you prefer)
        text = `${text}\n\n${quotedText}`.trim();
        html = `${html}<br><br>${quotedHtml}`.trim();
    }

    // Build RFC 822 message
    const rfc822Raw = buildRfc822({
        from: fromIdentity,
        to,
        subject,
        text,
        html,
        inReplyTo,        // only set in reply mode
        references,       // only set in reply mode
    });

    // Force string + CRLF for append
    const payload: string = (typeof rfc822Raw === "string" ? rfc822Raw : Buffer.from(rfc822Raw).toString("utf8"))
        .replace(/\r?\n/g, "\r\n");

    const client = await createImapClient(conn);
    try {
        const draftsPath = await resolveDraftsMailbox(client);
        const mailbox = draftsPath ?? "Drafts";

        await client.mailboxOpen(mailbox).catch(async () => {
            try { await client.mailboxCreate(mailbox); } catch {}
            await client.mailboxOpen(mailbox);
        });

        // Your installed typing expects flags as string[]
        const res = await client.append(mailbox, payload, ["\\Draft"]);
        const resUid = res && typeof res === "object" ? (res as any).uid ?? null : null;

        // Save IMAP pointer for sending later
        const draftsCol = await col<Draft>("Draft");
        await draftsCol.updateOne(
            { _id: draft._id },
            { $set: { imap: { mailbox, uid: resUid, appendedAt: new Date(), mode } } }
        );

        return { mailbox, uid: resUid, mode };
    } finally {
        try { await client.logout(); } catch {}
    }
}
