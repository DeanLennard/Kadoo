// apps/worker/src/adapters/smtp.ts
import nodemailer from "nodemailer";
import type { MailboxConnector } from "@kadoo/types";

export function makeSmtp(conn: MailboxConnector) {
    if (!conn.smtp) throw new Error("No SMTP config");
    const { host, port, secure, user, pass } = conn.smtp;

    return nodemailer.createTransport({
        host,
        port,
        secure,                        // true for 465, false for 587/STARTTLS
        auth: { user, pass },
        connectionTimeout: 10000,      // 10s
        greetingTimeout: 8000,         // 8s
        socketTimeout: 15000,          // 15s
        requireTLS: !secure,           // be strict when not using implicit TLS
        tls: { rejectUnauthorized: false }, // relax if using test/self-signed (remove in prod)
        logger: true,                  // nodemailer internal logging
        debug: true,                   // verbose SMTP logs
    } as any);
}
