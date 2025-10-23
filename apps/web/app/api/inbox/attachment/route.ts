// /api/inbox/attachment/route.ts
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { col } from "@/lib/db";
import type { MailboxConnector, MailMessage } from "@kadoo/types";
import { createImapClient } from "@/../../apps/worker/src/runners/imapClient";
import type { Readable } from "stream";

const DOWNLOAD_TIMEOUT_MS = 20_000; // keep it snappy

async function getPartContentByUid(
    client: any,
    uid: number,
    partId: string
): Promise<Buffer | Readable | undefined> {
    for await (const it of client.fetch({ uid }, { bodyParts: [partId] })) {
        const parts: Map<any, any> | undefined = (it as any).bodyParts;
        if (!parts || typeof parts.get !== "function") break;

        // 1) direct get with string key
        let hit = parts.get(partId);

        // 2) try numeric key (some libs store as number)
        if (!hit) {
            const maybeNum = Number(partId);
            if (!Number.isNaN(maybeNum)) hit = parts.get(maybeNum);
        }

        // 3) fallback: scan keys and pick the one that equals (stringified) partId
        if (!hit) {
            for (const [k, v] of parts.entries()) {
                if (String(k) === partId) { hit = v; break; }
            }
        }

        // 4) last-ditch: take the *only* part if there’s exactly one
        if (!hit && parts.size === 1) {
            const only = [...parts.values()][0];
            hit = only;
        }

        if (hit?.content) return hit.content as Buffer | Readable;
        // Some servers put content directly on the item:
        if ((hit && Buffer.isBuffer(hit)) || (hit && typeof hit.pipe === "function")) {
            return hit as any;
        }
        break;
    }
    return undefined;
}

async function downloadWholeMessageByUid(client: any, uid: number): Promise<Buffer | undefined> {
    const dl = await client.download({ uid }).catch(() => null as any);
    if (!dl?.content) return;
    if (Buffer.isBuffer(dl.content)) return dl.content as Buffer;
    // stream -> buffer
    return await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        (dl.content as Readable)
            .on("data", (c) => chunks.push(Buffer.from(c)))
            .on("end", () => resolve(Buffer.concat(chunks)))
            .on("error", reject);
    });
}

export async function GET(req: Request) {
    const { tenantId } = await requireSession();
    const url = new URL(req.url);
    const threadId = url.searchParams.get("threadId") || "";
    const uid = Number(url.searchParams.get("uid") || "");
    const filename = url.searchParams.get("filename") || "";

    if (!threadId || !uid || !filename) {
        return NextResponse.json({ error: "Bad input" }, { status: 400 });
    }

    const messages = await col<MailMessage>("MailMessage");
    const msg = await messages.findOne({ tenantId, threadId, uid });
    if (!msg) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const connectors = await col<MailboxConnector>("MailboxConnector");
    const conn = await connectors.findOne({ tenantId, type: "imap" });
    if (!conn?.imap) return NextResponse.json({ error: "No IMAP connector" }, { status: 400 });

    const client = await createImapClient(conn);

    const box = msg.folder || "INBOX";

    type DbAtt = { filename: string; contentType?: string; size?: number; partId?: string };
    let att: DbAtt | undefined = (msg as any).attachments?.find(
        (a: DbAtt) =>
            a?.filename === filename ||
            a?.filename?.toLowerCase() === filename.toLowerCase() ||
            decodeURIComponent(filename) === a?.filename
    );

    // helper to coerce whatever we found into a clean "2" / "2.1" string
    const toPartIdString = (val: unknown): string | undefined => {
        if (!val) return undefined;
        if (typeof val === "string") return val;
        if (typeof (val as any).part === "string") return (val as any).part; // sometimes nested
        try {
            // last-ditch: some libs put { part: 2 } or similar
            const s = String((val as any).part ?? val).trim();
            return s && s !== "[object Object]" ? s : undefined;
        } catch {
            return undefined;
        }
    };

    let partId = toPartIdString(att?.partId);

    if (!partId) {
        // ---- fallback: fetch BODYSTRUCTURE and find by filename ----
        await client.mailboxOpen(msg.folder || "INBOX", { readOnly: true });

        let bodyStruct: any | null = null;
        for await (const it of client.fetch({ uid }, { bodyStructure: true })) {
            bodyStruct = (it as any).bodyStructure || null;
            break;
        }
        if (!bodyStruct) return NextResponse.json({ error: "No content" }, { status: 404 });

        // robust search for filename in the structure
        const norm = (s: any) => String(s ?? "").trim().toLowerCase();
        const wantA = norm(filename);
        const wantB = norm(decodeURIComponent(filename));

        const findPart = (node: any): string | undefined => {
            if (!node) return;
            // leaf?
            const leafPart = toPartIdString(node.part);
            const name =
                node?.dispositionParameters?.filename ??
                node?.parameters?.name ??
                node?.id?.name ?? "";
            if (leafPart && (norm(name) === wantA || norm(name) === wantB)) {
                return leafPart;
            }
            // recurse
            for (const child of node?.childNodes || []) {
                const hit = findPart(child);
                if (hit) return hit;
            }
        };

        partId = findPart(bodyStruct);
        if (!partId) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });

        // keep a normalized copy for downstream use
        att = {
            filename,
            contentType: att?.contentType,
            size: att?.size,
            partId, // normalized
        };
    }

    if (!partId || !/^\d+(\.\d+)*$/.test(partId)) {
        return NextResponse.json({ error: "Bad attachment part id" }, { status: 400 });
    }

    try {
        await client.mailboxOpen(box, { readOnly: true });

        // 1) try the UID you have
        let content = await withTimeout(getPartContentByUid(client, uid, partId), DOWNLOAD_TIMEOUT_MS);

        // 2) if not found, try Message-ID -> UID
        if (!content && msg.msgId) {
            const maybeHits = await client
                .search({ header: { "message-id": msg.msgId } })
                .catch(() => [] as number[]);

            const hits: number[] = Array.isArray(maybeHits) ? maybeHits : [];
            const hitUid = hits.length ? hits[hits.length - 1] : undefined;
            if (hitUid) {
                content = await withTimeout(getPartContentByUid(client, hitUid, partId), DOWNLOAD_TIMEOUT_MS);
            }
        }

        // 3) last resort: download whole message by UID and parse the one attachment
        if (!content) {
            const whole = await withTimeout(downloadWholeMessageByUid(client, uid), DOWNLOAD_TIMEOUT_MS).catch(() => undefined);
            if (whole) {
                const { simpleParser } = await import("mailparser");
                const parsed = await simpleParser(whole);
                const want = filename.trim().toLowerCase();
                const att = (parsed.attachments || []).find(a =>
                    (a.filename || "attachment").toLowerCase() === want ||
                    decodeURIComponent(want) === (a.filename || "attachment").toLowerCase()
                );
                if (att?.content) {
                    content = att.content as Buffer | Readable;
                }
            }
        }

        if (!content) {
            return NextResponse.json({ error: "No content" }, { status: 404 });
        }

        return streamResponseFrom(content, att?.contentType, filename);

    } finally {
        try { await client.logout(); } catch {}
    }
}

// ---- helpers ----

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(Object.assign(new Error("IMAP download timeout"), { code: "Timeout" })), ms);
        p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
    });
}

function streamResponseFrom(content: Buffer | Readable | undefined, contentType?: string, filename?: string) {
    if (!content) return NextResponse.json({ error: "No content" }, { status: 404 });

    // Node stream → Web ReadableStream, or Buffer → Uint8Array
    if (Buffer.isBuffer(content)) {
        const body = new Uint8Array(content);
        return new NextResponse(body, {
            status: 200,
            headers: {
                "Content-Type": contentType || "application/octet-stream",
                "Content-Length": String(body.byteLength),
                "Content-Disposition": `attachment; filename="${encodeURIComponent(filename || "attachment")}"`,
                "Cache-Control": "private, no-store",
            },
        });
    }

    // Stream (preferred for large files)
    const stream = new ReadableStream({
        start(controller) {
            (content as Readable)
                .on("data", (chunk) => controller.enqueue(new Uint8Array(chunk)))
                .on("end", () => controller.close())
                .on("error", (err) => controller.error(err));
        },
        type: "bytes",
    });

    return new NextResponse(stream, {
        status: 200,
        headers: {
            "Content-Type": contentType || "application/octet-stream",
            "Content-Disposition": `attachment; filename="${encodeURIComponent(filename || "attachment")}"`,
            "Cache-Control": "private, no-store",
        },
    });
}
