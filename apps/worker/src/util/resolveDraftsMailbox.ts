// apps/worker/src/util/resolveDraftsMailbox.ts
import type { ImapFlow, ListResponse } from "imapflow";

const DRAFT_CANDIDATES = [
    "\\Drafts",
    "Drafts", "INBOX.Drafts", "[Gmail]/Drafts",
];

export async function resolveDraftsMailbox(client: ImapFlow): Promise<string | null> {
    const list: ListResponse[] = await client.list();

    // Prefer SPECIAL-USE \Drafts
    for (const mb of list) {
        const rawFlags = mb.flags ?? [];
        const flagsArr = Array.isArray(rawFlags)
            ? rawFlags
            : Array.from(rawFlags as Set<string>); // normalize Set -> array

        const flags = flagsArr.map((f: unknown) => String(f).toUpperCase());
        if (flags.includes("\\DRAFTS")) return mb.path;
    }

    // Fall back to common names
    const paths = new Set<string>(list.map((mb) => mb.path));
    for (const name of DRAFT_CANDIDATES) {
        if (paths.has(name)) return name;
    }

    return null;
}
