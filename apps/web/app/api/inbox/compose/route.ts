// apps/web/app/api/inbox/compose/route.ts
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { col } from "@/lib/db";
import type { MailboxConnector, MailMessage, MailThread } from "@kadoo/types";
import nodemailer from "nodemailer";
import { simpleParser, type AddressObject } from "mailparser";
import { createImapClient } from "@/../../apps/worker/src/runners/imapClient";

type JsonBody = {
    to: string[];
    cc?: string[];
    subject: string;
    html?: string;
    text?: string;
};

// keep aligned with your IMAP allowlist
const RELAXED_TLS_HOST_ALLOWLIST = [/\.extendcp\.co\.uk$/i, /(^|\.)kadoo\.io$/i];
const canRelax = (host: string, allowSelfSigned?: boolean) =>
    !!allowSelfSigned && RELAXED_TLS_HOST_ALLOWLIST.some((re) => re.test(host));

function extractAddresses(x: AddressObject | AddressObject[] | undefined): string[] {
    if (!x) return [];
    if (Array.isArray(x)) {
        return x.flatMap((item) => item.value ?? [])
            .map((v) => v.address)
            .filter((s): s is string => Boolean(s));
    }
    return (x.value ?? []).map((v) => v.address).filter((s): s is string => Boolean(s));
}

export async function POST(req: Request) {
    const { tenantId } = await requireSession();

    // Accept both JSON and multipart/form-data
    const ct = req.headers.get("content-type") || "";
    let to: string[] = [];
    let cc: string[] = [];
    let subject = "";
    let html = "";
    let text = "";
    const files: { filename: string; type: string; bytes: Buffer }[] = [];

    if (ct.includes("multipart/form-data")) {
        const form = await req.formData();
        to = form.getAll("to[]").map(v => String(v));
        cc = form.getAll("cc[]").map(v => String(v));
        subject = String(form.get("subject") || "");
        html = String(form.get("html") || "");
        text = String(form.get("text") || "");

        for (const entry of form.getAll("attachments")) {
            const f = entry as File;
            const ab = await f.arrayBuffer();
            files.push({
                filename: f.name || "attachment",
                type: f.type || "application/octet-stream",
                bytes: Buffer.from(ab),
            });
        }
    } else {
        const body = (await req.json()) as JsonBody;
        to = body.to || [];
        cc = body.cc || [];
        subject = body.subject || "";
        html = body.html || "";
        text = body.text || "";
    }

    if (!to.length || !subject) {
        return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const connectors = await col<MailboxConnector>("MailboxConnector");
    const conn = await connectors.findOne({ tenantId, type: "imap" });
    if (!conn || !conn.smtp || !conn.imap) {
        return NextResponse.json({ error: "No SMTP/IMAP connector" }, { status: 400 });
    }

    // Avoid sending to ourselves
    const myEmails = new Set([conn.smtp.user, conn.imap.user].filter(Boolean).map(e => e!.toLowerCase()));
    to = to.filter(e => !myEmails.has(e.toLowerCase()));
    cc = cc.filter(e => !myEmails.has(e.toLowerCase()))
        .filter((v, i, a) => a.indexOf(v) === i);

    if (to.length === 0) {
        return NextResponse.json({ error: "No valid recipients after filtering" }, { status: 400 });
    }

    // ---- 1) Send via SMTP (strict first; optional relaxed fallback) ----
    const smtpHost = conn.smtp.host;
    const baseTransport = {
        host: smtpHost,
        port: conn.smtp.port,
        secure: !!conn.smtp.secure,
        auth: { user: conn.smtp.user, pass: conn.smtp.pass },
        tls: { rejectUnauthorized: true } as any,
    };

    const mailOptions: any = {
        from: conn.smtp.user,
        to: to.join(", "),
        cc: cc.join(", "),
        subject,
        html: html || undefined,
        text: text || undefined,
        attachments: files.map(f => ({
            filename: f.filename,
            contentType: f.type,
            content: f.bytes,
        })),
    };

    async function sendStrict() {
        return nodemailer.createTransport(baseTransport as any).sendMail(mailOptions);
    }
    async function sendRelaxed() {
        return nodemailer.createTransport(
            { ...baseTransport, tls: { rejectUnauthorized: false } } as any
        ).sendMail(mailOptions);
    }

    let sentInfo;
    try {
        sentInfo = await sendStrict();
    } catch (e: any) {
        if (e?.code === "ESOCKET" && canRelax(smtpHost, conn.smtp.allowSelfSigned ?? conn.imap.allowSelfSigned)) {
            sentInfo = await sendRelaxed();
        } else {
            return NextResponse.json(
                { error: e?.message || "SMTP connection failed", code: e?.code || "SMTP" },
                { status: 500 }
            );
        }
    }

    // ---- 2) RFC822 for IMAP append (note: this minimal raw omits binary attachments) ----
    const raw = `From: ${conn.smtp.user}
To: ${to.join(", ")}
${cc.length ? `Cc: ${cc.join(", ")}\n` : ""}Subject: ${subject}
Message-ID: ${sentInfo.messageId}
MIME-Version: 1.0
Content-Type: multipart/alternative; boundary="kadoo-mixed"

--kadoo-mixed
Content-Type: text/plain; charset="utf-8"

${(text || "").replace(/\r?\n/g, "\r\n")}

--kadoo-mixed
Content-Type: text/html; charset="utf-8"

${(html || "").replace(/\r?\n/g, "\r\n")}

--kadoo-mixed--`;

    // ---- 3) Append to Sent + insert into DB as a brand-new thread ----
    const client = await createImapClient(conn);
    try {
        const sentCandidates = ["Sent", "INBOX.Sent", "[Gmail]/Sent Mail", "Sent Items"];
        let sentBox = "Sent";
        for (const f of sentCandidates) {
            try { await client.mailboxOpen(f, { readOnly: true }); sentBox = f; break; } catch {}
        }
        await client.mailboxOpen(sentBox);
        await client.append(sentBox, Buffer.from(raw), ["\\Seen"]);

        const parsed = await simpleParser(raw);
        const date = parsed.date || new Date();
        const toParsed = extractAddresses(parsed.to);
        const ccParsed = extractAddresses(parsed.cc);
        const messageId = sentInfo.messageId || parsed.messageId || `kadoo-${Date.now()}`;
        const subjectParsed = parsed.subject || subject;
        const htmlParsed = typeof parsed.html === "string" ? parsed.html : undefined;
        const textParsed = typeof parsed.text === "string" ? parsed.text : undefined;

        const threadsCol = await col<MailThread>("MailThread");
        const messagesCol = await col<MailMessage>("MailMessage");

        const threadId = `${conn._id}:${messageId}`;
        await threadsCol.updateOne(
            { _id: threadId },
            {
                $setOnInsert: {
                    _id: threadId,
                    tenantId,
                    connectorId: conn._id,
                    subject: subjectParsed,
                    participants: [conn.smtp.user, ...toParsed, ...ccParsed].filter((v, i, a) => !!v && a.indexOf(v) === i),
                    status: "awaiting_them",
                    facts: [],
                    lastMessageIds: [],
                    createdAt: date,
                    folder: sentBox,
                },
                $set: { lastTs: date, unread: 0 },
            },
            { upsert: true }
        );

        const syntheticUid = Date.now();
        await messagesCol.updateOne(
            { _id: `${threadId}:${syntheticUid}` },
            {
                $set: {
                    _id: `${threadId}:${syntheticUid}`,
                    tenantId,
                    threadId,
                    msgId: messageId,
                    uid: syntheticUid,
                    from: conn.smtp.user,
                    to: toParsed,
                    cc: ccParsed,
                    date,
                    text: textParsed,
                    html: htmlParsed,
                    folder: sentBox,
                    flags: ["\\Seen"],
                    attachments: files.map(f => ({
                        filename: f.filename,
                        contentType: f.type,
                        size: f.bytes.length,
                    })),
                },
            },
            { upsert: true }
        );
    } finally {
        try { await client.logout(); } catch {}
    }

    return NextResponse.json({ ok: true });
}
