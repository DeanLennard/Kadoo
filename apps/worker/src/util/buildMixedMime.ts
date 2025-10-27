// apps/worker/src/util/buildMixedMime.ts

import { randomBytes } from "crypto";

export function buildMixedMime({
                                   from,
                                   to,
                                   subject,
                                   text,
                                   html,
                               }: {
    from: string;
    to: string[];
    subject: string;
    text: string;
    html?: string;
}) {
    // Generate a unique boundary for separating MIME parts
    const boundary = "----=_Part_" + randomBytes(8).toString("hex");

    // Normalise line endings for RFC 2822 compliance
    const normalize = (s: string) => s.replace(/\r?\n/g, "\r\n");

    const headers = [
        `From: ${from}`,
        `To: ${to.join(", ")}`,
        `Subject: ${subject}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        ``,
    ].join("\r\n");

    // Always include text/plain part first
    const textPart = [
        `--${boundary}`,
        `Content-Type: text/plain; charset="utf-8"`,
        `Content-Transfer-Encoding: 7bit`,
        ``,
        normalize(text || ""),
        ``,
    ].join("\r\n");

    // Optional HTML part (if provided)
    const htmlPart = html
        ? [
            `--${boundary}`,
            `Content-Type: text/html; charset="utf-8"`,
            `Content-Transfer-Encoding: 7bit`,
            ``,
            normalize(html),
            ``,
        ].join("\r\n")
        : "";

    // Final closing boundary
    const closing = `--${boundary}--\r\n`;

    // Join everything and encode as Buffer (for SMTP send or IMAP append)
    return Buffer.from(headers + textPart + htmlPart + closing, "utf8");
}
