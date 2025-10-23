// apps/worker/src/adapters/smtp.ts
import nodemailer from "nodemailer";
import type { MailboxConnector } from "@kadoo/types";

export function makeSmtp(conn: MailboxConnector) {
    if (!conn.smtp) throw new Error("No SMTP config");
    const { host, port, secure, user, pass } = conn.smtp;
    return nodemailer.createTransport({
        host, port, secure,
        auth: { user, pass },
    });
}
