// apps/web/app/api/inbox/reply/route.ts
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { col } from "@/lib/db";
import type { MailboxConnector, MailMessage, MailThread } from "@kadoo/types";
import nodemailer from "nodemailer";
import { simpleParser } from "mailparser";
import { createImapClient } from "@/../../apps/worker/src/runners/imapClient";
import type { AddressObject } from "mailparser";

// keep this aligned with your IMAP allowlist
const RELAXED_TLS_HOST_ALLOWLIST = [/\.extendcp\.co\.uk$/i, /(^|\.)kadoo\.io$/i];
const canRelax = (host: string, allowSelfSigned?: boolean) =>
    !!allowSelfSigned && RELAXED_TLS_HOST_ALLOWLIST.some(re => re.test(host));

function extractAddresses(x: AddressObject | AddressObject[] | undefined): string[] {
    if (!x) return [];
    if (Array.isArray(x)) {
        return x.flatMap(item => (item.value ?? []))
            .map(v => v.address)
            .filter((s): s is string => Boolean(s));
    }
    return (x.value ?? []).map(v => v.address).filter((s): s is string => Boolean(s));
}

export async function POST(req: Request) {
    const { tenantId } = await requireSession();

    let threadId = "";
    let subject = "";
    let to: string[] = [];
    let cc: string[] = [];
    let html = "";
    let text = "";
    const files: { filename: string; type: string; bytes: Buffer }[] = [];

    const ct = req.headers.get("content-type") || "";
    if (ct.includes("multipart/form-data")) {
        const form = await req.formData();
        threadId = String(form.get("threadId") || "");
        subject  = String(form.get("subject")  || "");
        to       = form.getAll("to[]").map(v => String(v));
        cc       = form.getAll("cc[]").map(v => String(v));
        html     = String(form.get("html") || "");
        text     = String(form.get("text") || "");
        for (const entry of form.getAll("attachments")) {
            const f = entry as File;
            const ab = await f.arrayBuffer();
            files.push({ filename: f.name || "attachment", type: f.type || "application/octet-stream", bytes: Buffer.from(ab) });
        }
    } else {
        const body = await req.json().catch(() => ({}));
        threadId = String(body.threadId || "");
        subject  = String(body.subject  || "");
        to       = Array.isArray(body.to) ? body.to : [];
        cc       = Array.isArray(body.cc) ? body.cc : [];
        html     = String(body.html || "");
        text     = String(body.text || "");
    }

    if (!threadId || !to.length || !subject) {
        return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const connectors = await col<MailboxConnector>("MailboxConnector");
    const conn = await connectors.findOne({ tenantId, type: "imap" });
    if (!conn) {
        return NextResponse.json({ error: "No connector" }, { status: 400 });
    }
    if (!conn.smtp || !conn.imap) {
        return NextResponse.json({ error: "No SMTP/IMAP connector" }, { status: 400 });
    }

    // filter out self addresses (as you already do) ...
    const myEmails = new Set([conn.smtp.user, conn.imap.user].filter(Boolean).map(e => e!.toLowerCase()));
    to = to.filter(e => !myEmails.has(e.toLowerCase()));
    cc = cc.filter(e => !myEmails.has(e.toLowerCase())).filter((v, i, a) => a.indexOf(v) === i);
    if (to.length === 0) return NextResponse.json({ error: "No valid recipients after filtering" }, { status: 400 });

    // ---- 1) Send via SMTP (strict first, optional relaxed fallback) ----
    const smtpHost = conn.smtp.host;
    const baseTransport = {
        host: smtpHost,
        port: conn.smtp.port,
        secure: !!conn.smtp.secure,           // 465 vs 587 STARTTLS
        auth: { user: conn.smtp.user, pass: conn.smtp.pass },
        tls: { rejectUnauthorized: true } as any, // strict first
    };

    const mail = {
        from: conn.smtp.user,
        to: to.join(", "),
        cc: cc.join(", "),
        subject,
        html: html || undefined,
        text: text || undefined,
        attachments: files.map(f => ({
            filename: f.filename,
            contentType: f.type,
            content: f.bytes, // Buffer
        })),
    };

    async function sendWith(tlsRelax: boolean) {
        const transport = nodemailer.createTransport({
            ...baseTransport,
            tls: { rejectUnauthorized: !tlsRelax } as any,
        } as any);
        return transport.sendMail(mail as any);
    }

    let sentInfo;
    try {
        sentInfo = await sendWith(false);
    } catch (e: any) {
        if (e?.code === "ESOCKET" && (conn.smtp.allowSelfSigned ?? conn.imap.allowSelfSigned)) {
            sentInfo = await sendWith(true);
        } else {
            return NextResponse.json(
                { error: e?.message || "SMTP connection failed", code: e?.code || "SMTP" },
                { status: 500 }
            );
        }
    }

    // ---- 2) Build a minimal RFC822 and append to Sent on IMAP ----
    const raw =
        `From: ${conn.smtp.user}
To: ${to.join(", ")}
${cc.length ? `Cc: ${cc.join(", ")}\n` : ""}Subject: ${subject}
Message-ID: ${sentInfo.messageId}
MIME-Version: 1.0
Content-Type: text/html; charset="utf-8"

${(html || text || "").replace(/\r?\n/g, "\r\n")}`;

    const client = await createImapClient(conn);
    try {
        const sentCandidates = ["Sent", "INBOX.Sent", "[Gmail]/Sent Mail", "Sent Items"];
        let sentBox = "Sent";
        for (const f of sentCandidates) {
            try { await client.mailboxOpen(f, { readOnly: true }); sentBox = f; break; } catch {}
        }
        await client.mailboxOpen(sentBox);
        await client.append(sentBox, Buffer.from(raw), ["\\Seen"]);

        // upsert local message (without re-attaching binaries)
        const { simpleParser } = await import("mailparser");
        const parsed = await simpleParser(raw);
        const date = parsed.date || new Date();
        const messageId = sentInfo.messageId || parsed.messageId || `kadoo-${Date.now()}`;

        const threadsCol = await col<MailThread>("MailThread");
        const messagesCol = await col<MailMessage>("MailMessage");

        const syntheticUid = Date.now();
        await messagesCol.updateOne(
            { _id: `${threadId}:${syntheticUid}` },
            {
                $set: {
                    _id: `${threadId}:${syntheticUid}`,
                    tenantId, threadId,
                    msgId: messageId,
                    uid: syntheticUid,
                    from: conn.smtp.user,
                    to, cc,
                    date,
                    text: parsed.text || text || "",
                    html: (typeof parsed.html === "string" ? parsed.html : html) || undefined,
                    folder: sentBox,
                    flags: ["\\Seen"],
                    attachments: files.map(f => ({ filename: f.filename, contentType: f.type, size: f.bytes.length })),
                },
            },
            { upsert: true }
        );

        await threadsCol.updateOne(
            { _id: threadId, tenantId },
            { $set: { lastTs: date } }
        );
    } finally {
        try { await client.logout(); } catch {}
    }

    return NextResponse.json({ ok: true });
}
