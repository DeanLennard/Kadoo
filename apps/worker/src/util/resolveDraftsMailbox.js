const DRAFT_CANDIDATES = [
    "\\Drafts",
    "Drafts", "INBOX.Drafts", "[Gmail]/Drafts",
];
export async function resolveDraftsMailbox(client) {
    const list = await client.list();
    // Prefer SPECIAL-USE \Drafts
    for (const mb of list) {
        const rawFlags = mb.flags ?? [];
        const flagsArr = Array.isArray(rawFlags)
            ? rawFlags
            : Array.from(rawFlags); // normalize Set -> array
        const flags = flagsArr.map((f) => String(f).toUpperCase());
        if (flags.includes("\\DRAFTS"))
            return mb.path;
    }
    // Fall back to common names
    const paths = new Set(list.map((mb) => mb.path));
    for (const name of DRAFT_CANDIDATES) {
        if (paths.has(name))
            return name;
    }
    return null;
}
