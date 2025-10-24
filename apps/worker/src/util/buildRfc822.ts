// util/buildRfc822.ts
export function buildRfc822(opts: {
    from: string;
    to: string[];
    subject: string;
    text?: string;
    html?: string;
    inReplyTo?: string;
    references?: string[];
}): string {
    const boundary = "=_kadoo_" + Math.random().toString(36).slice(2);
    const headers = [
        `From: ${opts.from}`,
        `To: ${opts.to.join(", ")}`,
        `Subject: ${opts.subject}`,
        `MIME-Version: 1.0`,
        opts.inReplyTo ? `In-Reply-To: ${opts.inReplyTo}` : null,
        opts.references && opts.references.length ? `References: ${opts.references.join(" ")}` : null,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ].filter(Boolean).join("\r\n");

    const parts: string[] = [];

    if (opts.text) {
        parts.push(
            `--${boundary}`,
            `Content-Type: text/plain; charset=utf-8`,
            `Content-Transfer-Encoding: 8bit`,
            ``,
            opts.text
        );
    }

    if (opts.html) {
        parts.push(
            `--${boundary}`,
            `Content-Type: text/html; charset=utf-8`,
            `Content-Transfer-Encoding: 8bit`,
            ``,
            opts.html
        );
    }

    parts.push(`--${boundary}--`, ``);

    return headers + "\r\n\r\n" + parts.join("\r\n");
}
