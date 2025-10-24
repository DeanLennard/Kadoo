// apps/worker/src/workers/appendImapDraft.ts
import { createImapClient } from "../runners/imapClient";
import type { MailboxConnector, MailMessage, Draft } from "@kadoo/types";
import { col } from "../db";
import { resolveDraftsMailbox } from "../util/resolveDraftsMailbox";
import { buildRfc822 } from "../util/buildRfc822";

type AppendOptionsLite = {
    mailbox?: string;
    flags?: string[];
    internalDate?: Date;
};

export async function appendImapDraft(args: {
    tenantId: string;
    threadId: string;
    uidRef: number;
    draft: Draft;
}) {
    const { tenantId, threadId, uidRef, draft } = args;

    const connectors = await col<MailboxConnector>("MailboxConnector");
    const messages   = await col<MailMessage>("MailMessage");

    const conn = await connectors.findOne({ tenantId, type: "imap" });
    if (!conn?.imap) return null;

    const parent = await messages.findOne({ tenantId, threadId, uid: uidRef });
    if (!parent) return null;

    // Addressing
    const replyToArr = (parent as any).replyTo as string[] | undefined;
    const to: string[] =
        (replyToArr && replyToArr.length ? replyToArr :
            (parent.from ? [parent.from] : parent.to)) || [];

    const subject = draft.subject ?? "Re:";
    const fromDisplay = to[0] || "Team <noreply@example.com>";

    const parentMsgId = parent.msgId && parent.msgId.startsWith("<")
        ? parent.msgId
        : parent.msgId
            ? `<${parent.msgId}>`
            : undefined;

    const inReplyTo = parentMsgId;
    const references = parentMsgId ? [parentMsgId] : [];

    const rfc822 = buildRfc822({
        from: fromDisplay,
        to,
        subject,
        text: draft.text ?? "",
        html: draft.html ?? "",
        inReplyTo,
        references,
    });

    const payload: string =
        typeof rfc822 === "string" ? rfc822 : Buffer.from(rfc822).toString("utf8");

    const client = await createImapClient(conn);
    try {
        const draftsPath = await resolveDraftsMailbox(client);
        const mailbox = draftsPath ?? "Drafts";

        await client.mailboxOpen(mailbox).catch(async () => {
            try { await client.mailboxCreate(mailbox); } catch {}
            await client.mailboxOpen(mailbox);
        });

        // rfc822 is a string per your buildRfc822()
        const res = await (client as any).append(
            payload,
            { flags: ["\\Draft"] } as AppendOptionsLite
        );
        const resUid = res && typeof res === "object" ? (res as any).uid ?? null : null;

        const draftsCol = await col<Draft>("Draft");
        await draftsCol.updateOne(
            { _id: draft._id },
            { $set: { imap: { mailbox, uid: resUid, appendedAt: new Date() } } }
        );

        return { mailbox, uid: resUid };
    } finally {
        try { await client.logout(); } catch {}
    }
}
