// util/buildRfc822.ts
export function buildRfc822(args) {
    const { from, to, subject, text, html, inReplyTo, references } = args;
    const headers = [
        `From: ${from}`,
        `To: ${to.join(", ")}`,
        `Subject: ${subject}`,
        `MIME-Version: 1.0`,
        `Content-Type: ${html ? 'text/html; charset="UTF-8"' : 'text/plain; charset="UTF-8"'}`,
    ];
    if (inReplyTo)
        headers.push(`In-Reply-To: ${inReplyTo}`);
    if (references && references.length)
        headers.push(`References: ${references.join(" ")}`);
    const body = html ?? text ?? "";
    // IMPORTANT: normalize to CRLF per RFC 5322/822
    const crlf = (s) => s.replace(/\r?\n/g, "\r\n");
    return crlf(headers.join("\r\n")) + "\r\n\r\n" + crlf(body);
}
