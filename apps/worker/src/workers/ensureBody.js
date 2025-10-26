// apps/worker/src/workers/ensureBody.ts
import { createImapClient } from "../runners/imapClient";
import { col } from "../db";
import { simpleParser } from "mailparser";
function collectAttachments(struct) {
    const out = [];
    const walk = (n) => {
        if (!n)
            return;
        const isLeaf = Boolean(n.part);
        if (isLeaf) {
            const disp = String(n.disposition || "").toUpperCase();
            const fn = n?.dispositionParameters?.filename || n?.parameters?.name;
            if (disp.includes("ATTACHMENT") || fn) {
                out.push({
                    filename: String(fn || "attachment"),
                    contentType: `${n.type}/${n.subtype}`.toLowerCase(),
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
export async function ensureFullBody({ tenantId, threadId, uid, force }) {
    const messages = await col("MailMessage");
    const connectors = await col("MailboxConnector");
    const doc = await messages.findOne({ tenantId, threadId, uid });
    if (!doc)
        return null;
    // If we already have a body and not forcing, return it as-is
    if (!force && (doc.text || doc.html))
        return doc;
    const conn = await connectors.findOne({ tenantId, type: "imap" });
    if (!conn?.imap)
        return doc;
    const client = await createImapClient(conn);
    try {
        // Try the folder we think it's in; if that fails, we'll search by Message-ID
        const openOne = async (paths) => {
            for (const p of paths) {
                try {
                    await client.mailboxOpen(p, { readOnly: true });
                    return p;
                }
                catch { }
            }
            return null;
        };
        const recordedFolder = doc.folder || "INBOX";
        let opened = await openOne([recordedFolder]);
        if (!opened) {
            // try a few common ones
            opened = await openOne(["INBOX", "[Gmail]/Spam", "Spam", "Junk", "INBOX.Junk"]);
        }
        if (!opened)
            return doc; // nowhere to search
        // Prefer fetching both SOURCE and BODYSTRUCTURE so we can also persist attachments metadata
        let sourceBuf = null;
        let bodyStruct = null;
        // Try by UID first
        try {
            for await (const it of client.fetch(String(uid), { uid: true, source: true, bodyStructure: true })) {
                const src = it?.source;
                bodyStruct = it?.bodyStructure || null;
                if (src) {
                    sourceBuf = Buffer.isBuffer(src)
                        ? src
                        : await new Promise((resolve, reject) => {
                            const chunks = [];
                            src
                                .on("data", (c) => chunks.push(Buffer.from(c)))
                                .on("end", () => resolve(Buffer.concat(chunks)))
                                .on("error", reject);
                        });
                }
                break;
            }
        }
        catch { /* fall through to search */ }
        // Fallback: if we didn’t get the source (maybe moved folders), search by Message-ID header
        if (!sourceBuf && doc.msgId) {
            // Ask for UIDs; result can be number[] or false
            const searchRes = await client.search({ header: { "message-id": doc.msgId } }, { uid: true });
            const hits = Array.isArray(searchRes) ? searchRes : [];
            if (hits.length > 0) {
                const hitUid = String(hits[hits.length - 1]); // last occurrence
                for await (const it of client.fetch(hitUid, { uid: true, source: true, bodyStructure: true })) {
                    const src = it?.source;
                    bodyStruct = bodyStruct || it?.bodyStructure || null;
                    if (src) {
                        sourceBuf = Buffer.isBuffer(src)
                            ? src
                            : await new Promise((resolve, reject) => {
                                const chunks = [];
                                src
                                    .on("data", (c) => chunks.push(Buffer.from(c)))
                                    .on("end", () => resolve(Buffer.concat(chunks)))
                                    .on("error", reject);
                            });
                    }
                    break;
                }
                // If we found it in the *currently open* mailbox, persist the folder
                if (sourceBuf && opened && opened !== recordedFolder) {
                    await messages.updateOne({ tenantId, threadId, uid }, { $set: { folder: opened } });
                }
            }
        }
        if (!sourceBuf)
            return doc; // nothing we can do
        const parsed = await simpleParser(sourceBuf);
        const html = (typeof parsed.html === "string" ? parsed.html : "") ||
            (typeof parsed.textAsHtml === "string" ? parsed.textAsHtml : "");
        const text = typeof parsed.text === "string" ? parsed.text : "";
        const attachments = bodyStruct ? collectAttachments(bodyStruct) : (doc.attachments || []);
        await messages.updateOne({ tenantId, threadId, uid }, {
            $set: {
                html: html || undefined,
                text: text || undefined,
                attachments,
                bodyFetchedAt: new Date(),
            },
        });
        // return the freshest doc
        return await messages.findOne({ tenantId, threadId, uid });
    }
    finally {
        try {
            await client.logout();
        }
        catch { }
    }
}
