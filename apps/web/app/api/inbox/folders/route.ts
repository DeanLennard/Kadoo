// apps/web/app/api/inbox/folders/route.ts
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { col } from "@/lib/db";
import type { MailboxConnector } from "@kadoo/types";
import { createImapClient } from "@/../../apps/worker/src/runners/imapClient";

type Folder = { id: string; name: string; unread?: number };

export async function GET() {
    const { tenantId } = await requireSession();

    const connectors = await col<MailboxConnector>("MailboxConnector");
    const conn = await connectors.findOne({ tenantId, type: "imap" });

    // If no connector, degrade gracefully
    if (!conn?.imap) return NextResponse.json({ items: [{ id: "INBOX", name: "Inbox", unread: 0 }] });

    let client: any;
    try {
        client = await createImapClient(conn);
    } catch (e) {
        // Couldn’t connect (TLS issues etc). Return a minimal list instead of 500.
        return NextResponse.json({ items: [{ id: "INBOX", name: "Inbox", unread: 0 }] });
    }

    try {
        const items: Folder[] = [];

        // --- Strategy A: true LIST (preferred, if available on this imapflow build) ---
        const hasList = typeof client.list === "function";
        if (hasList) {
            try {
                for await (const box of client.list()) {
                    // Some servers expose Noselect placeholders
                    const noSelect = (box.flags || []).some((f: string) => String(f).toUpperCase() === "\\NOSELECT");
                    if (noSelect) continue;
                    items.push({ id: box.path, name: box.name || box.path, unread: 0 });
                }
            } catch {
                // fall through to Strategy B
            }
        }

        // --- Strategy B: probe common folders (works even when LIST is wonky) ---
        if (items.length === 0) {
            const candidates = [
                "INBOX",
                "Drafts", "INBOX.Drafts", "[Gmail]/Drafts",
                "Sent", "INBOX.Sent", "[Gmail]/Sent Mail", "Sent Items",
                "Archive", "INBOX.Archive", "[Gmail]/All Mail", "All Mail",
                "Trash", "INBOX.Trash", "Deleted Items", "Deleted Messages", "Bin", "[Gmail]/Trash",
                "Junk", "Spam", "INBOX.Junk", "[Gmail]/Spam",
            ];
            const seen = new Set<string>();

            for (const id of candidates) {
                if (seen.has(id)) continue;
                try {
                    const st = await client.status(id, { unseen: true });
                    items.push({ id, name: friendlyName(id, []), unread: Number(st?.unseen ?? 0) });
                    seen.add(id);
                } catch {
                    // ignore
                }
            }
        }

        // If we still have nothing, at least give Inbox
        if (items.length === 0) items.push({ id: "INBOX", name: "Inbox", unread: 0 });

        // Fetch UNSEEN for any item that doesn’t have it yet (cap it)
        const limited = items.slice(0, 40);
        await Promise.all(
            limited.map(async (it) => {
                if (typeof it.unread === "number") return;
                try {
                    const st = await client.status(it.id, { unseen: true });
                    it.unread = Number(st?.unseen ?? 0);
                } catch {
                    it.unread = 0;
                }
            })
        );

        // Sort: Inbox, Drafts, Sent, Archive/All, Trash, Junk, then alpha
        const rank = (id: string, name: string) => {
            const up = id.toUpperCase();
            const nm = name.toUpperCase();
            if (up === "INBOX") return 0;
            if (/DRAFT/.test(up) || /DRAFT/.test(nm)) return 1;
            if (/SENT/.test(up) || /SENT/.test(nm)) return 2;
            if (/ARCHIVE|ALL MAIL/.test(up) || /ARCHIVE|ALL MAIL/.test(nm)) return 3;
            if (/TRASH|DELETED|BIN/.test(up) || /TRASH|DELETED|BIN/.test(nm)) return 4;
            if (/JUNK|SPAM/.test(up) || /JUNK|SPAM/.test(nm)) return 5;
            return 9;
        };

        items.sort((a, b) =>
            rank(a.id, a.name) - rank(b.id, b.name) || a.name.localeCompare(b.name)
        );

        return NextResponse.json({ items });
    } catch {
        // Any unexpected error → degrade gracefully
        return NextResponse.json({ items: [{ id: "INBOX", name: "Inbox", unread: 0 }] });
    } finally {
        try { await client.logout(); } catch {}
    }
}

function friendlyName(id: string, flags: string[]): string {
    const up = id.toUpperCase();
    const f = flags.map(s => s.toUpperCase());

    if (up === "INBOX") return "Inbox";
    if (f.includes("\\DRAFTS") || /DRAFT/.test(up)) return "Drafts";
    if (f.includes("\\SENT") || /SENT/.test(up)) return "Sent";
    if (f.includes("\\ALL") || /ALL MAIL|ARCHIVE/.test(up)) return "Archive";
    if (f.includes("\\TRASH") || /TRASH|DELETED|BIN/.test(up)) return "Trash";
    if (f.includes("\\JUNK") || /JUNK|SPAM/.test(up)) return "Spam";

    // Gmail namespace cleanup
    return id.replace(/^\[Gmail\]\//i, "");
}

