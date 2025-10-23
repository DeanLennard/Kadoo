// apps/web/components/mail/MessageBody.tsx
"use client";
import DOMPurify from "dompurify";

export default function MessageBody({ html, text }: { html?: string; text?: string }) {
    if (html && html.trim().length) {
        const safe = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
        return <div dangerouslySetInnerHTML={{ __html: safe }} />;
    }
    return <pre className="text-sm bg-[var(--cloud)] rounded p-3 overflow-auto">{text || "(no content)"}</pre>;
}
