// apps/web/app/api/inbox/delete/route.ts
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { col } from "@/lib/db";
import type { MailboxConnector, MailMessage, MailThread } from "@kadoo/types";
import { createImapClient } from "@/../../apps/worker/src/runners/imapClient";

const TRASH_CANDIDATES = ["Trash", "Deleted Items", "INBOX.Trash", "[Gmail]/Trash"];

export async function POST(req: Request) {
    const { tenantId } = await requireSession();
    const { threadId, uid, folder } = (await req.json()) as {
        threadId: string;
        uid: number;
        folder?: string;
    };

    if (!threadId || typeof uid !== "number") {
        return NextResponse.json({ error: "Bad input" }, { status: 400 });
    }

    const messages = await col<MailMessage>("MailMessage");
    const threads = await col<MailThread>("MailThread");
    const msg = await messages.findOne({ tenantId, threadId, uid });
    if (!msg) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const connectors = await col<MailboxConnector>("MailboxConnector");
    const conn = await connectors.findOne({ tenantId, type: "imap" });
    if (!conn?.imap) return NextResponse.json({ error: "No IMAP connector" }, { status: 400 });

    const client = await createImapClient(conn);
    try {
        const box = (folder && String(folder)) || msg.folder || "INBOX";
        await client.mailboxOpen(box); // read-write

        // Try to move into a Trash-like mailbox first
        let moved = false;
        for (const candidate of TRASH_CANDIDATES) {
            try {
                // probe existence
                await client.mailboxOpen(candidate, { readOnly: true });
                // go back to source
                await client.mailboxOpen(box);
                await client.messageMove(String(uid), candidate, { uid: true });
                moved = true;
                break;
            } catch {
                // try next candidate
            }
        }

        if (!moved) {
            // Soft-delete in place, then expunge on CLOSE (IMAP standard behavior)
            await client.messageFlagsAdd(String(uid), ["\\Deleted"], { uid: true });
            await client.mailboxClose();            // <-- no args
            // (Optionally reopen the box if you need it right after)
            // await client.mailboxOpen(box);
        }

        // --- Local DB updates ---
        await messages.deleteOne({ _id: msg._id, tenantId });

        const left = await messages.countDocuments({ tenantId, threadId });
        if (left === 0) {
            await threads.deleteOne({ _id: threadId, tenantId });
        } else {
            // recompute lastTs and unread
            const latest = await messages
                .find({ tenantId, threadId })
                .project({ date: 1, flags: 1 })
                .sort({ date: -1 })
                .limit(1)
                .toArray();
            const lastTs = latest[0]?.date || new Date();
            const unread = await messages.countDocuments({
                tenantId,
                threadId,
                flags: { $nin: ["\\Seen"] } as any,
            });
            await threads.updateOne({ _id: threadId, tenantId }, { $set: { lastTs, unread } });
        }

        return NextResponse.json({ ok: true });
    } finally {
        try {
            await client.logout();
        } catch {}
    }
}
