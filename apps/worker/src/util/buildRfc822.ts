// util/buildRfc822.ts
export function buildRfc822(args: {
    from: string;
    to: string[];
    subject: string;
    text?: string;
    html?: string;
    inReplyTo?: string;
    references?: string[];
}): string {
    const headers: string[] = [
        `From: ${args.from}`,
        `To: ${args.to.join(", ")}`,
        `Subject: ${args.subject}`,
        `MIME-Version: 1.0`,
        ...(args.inReplyTo ? [`In-Reply-To: ${args.inReplyTo}`] : []),
        ...(args.references && args.references.length
            ? [`References: ${args.references.join(" ")}`]
            : []),
        // simple multipart/alternative or just text/plain if no html
    ];

    const boundary = "kadoo-boundary";
    if (args.html) {
        headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
        const parts = [
            `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${args.text ?? ""}`,
            `--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${args.html}`,
            `--${boundary}--`,
        ];
        return headers.join("\r\n") + `\r\n\r\n` + parts.join("\r\n");
    } else {
        headers.push(`Content-Type: text/plain; charset=utf-8`);
        return headers.join("\r\n") + `\r\n\r\n` + (args.text ?? "");
    }
}
