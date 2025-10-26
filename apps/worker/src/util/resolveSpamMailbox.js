// apps/worker/src/util/resolveSpamMailbox.ts
export async function resolveSpamMailbox(client) {
    // 1) Try special-use \Junk (best)
    const boxes = [];
    // imapflow.list() can be async-iterable depending on version
    try {
        const listed = await client.list();
        if (Array.isArray(listed)) {
            boxes.push(...listed);
        }
        else {
            for await (const b of client.list())
                boxes.push(b);
        }
    }
    catch {
        // ignore, fall back below
    }
    const isJunk = (b) => String(b?.specialUse || "").toLowerCase() === "\\junk" ||
        (Array.isArray(b?.flags) && b.flags.some((f) => String(f).toLowerCase() === "\\junk"));
    const junk = boxes.find(isJunk);
    if (junk?.path)
        return junk.path;
    // 2) Fall back to common names (your candidates list is great)
    const candidates = [
        "Junk", "Spam", "INBOX.Junk", "[Gmail]/Spam",
        "Bulk Mail", "Junk E-mail", "INBOX.Spam"
    ];
    for (const name of candidates) {
        try {
            await client.mailboxOpen(name, { readOnly: true });
            // close back to INBOX to leave state clean
            await client.mailboxOpen("INBOX", { readOnly: true });
            return name;
        }
        catch { /* try next */ }
    }
    return null; // we'll fallback to \Junk flagging
}
