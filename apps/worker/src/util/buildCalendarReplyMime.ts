// apps/worker/src/util/buildCalendarReplyMime.ts
export function buildCalendarReplyMime({
                                           from, to, subject, text, html, ics
                                       }: {
    from: string; to: string[]; subject: string; text: string; html?: string; ics: string;
}) {
    const boundary = "----=_KadooBoundary_" + Math.random().toString(36).slice(2);

    const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

    const headers =
        `From: ${from}\r\n` +
        `To: ${to.join(", ")}\r\n` +
        `Subject: ${subject}\r\n` +
        `MIME-Version: 1.0\r\n` +
        `Content-Type: multipart/alternative; boundary="${boundary}"\r\n` +
        `\r\n`;

    const textPart =
        `--${boundary}\r\n` +
        `Content-Type: text/plain; charset="utf-8"\r\n` +
        `Content-Transfer-Encoding: base64\r\n\r\n` +
        b64(text) + `\r\n`;

    const htmlPart = html
        ? (`--${boundary}\r\n` +
            `Content-Type: text/html; charset="utf-8"\r\n` +
            `Content-Transfer-Encoding: base64\r\n\r\n` +
            b64(html) + `\r\n`)
        : "";

    const icsPart =
        `--${boundary}\r\n` +
        `Content-Type: text/calendar; method=REPLY; component=VEVENT; charset="utf-8"; name="invite.ics"\r\n` +
        `Content-Transfer-Encoding: 7bit\r\n` +
        `Content-Disposition: inline; filename="invite.ics"\r\n\r\n` +
        ics + `\r\n`;

    const end = `--${boundary}--\r\n`;

    return Buffer.from(headers + textPart + htmlPart + icsPart + end, "utf-8");
}
