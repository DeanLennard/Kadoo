// apps/worker/src/util/signature.ts

export function looksSigned(s: string): boolean {
    const tail = s.trim().slice(-200).toLowerCase();
    return /\b(best|kind|warm|many|thanks|regards)\b[\s,]*\n/.test(tail)
        || /\b(best|kind|warm|many|thanks)\b[\s,]*<br\/?>/i.test(tail);
}

export function stripHtml(s: string): string {
    return s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
}

export function escapeHtml(s: string): string {
    return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

export function buildSignatures(settings: {
    senderName?: string; companyName?: string; signatureHtml?: string;
}) {
    const senderName = settings.senderName?.trim();
    const companyName = settings.companyName?.trim();

    const htmlSignature =
        settings.signatureHtml?.trim() ||
        (senderName
            ? [
                "<br><br>",
                "Best regards,",
                "<br/>",
                `<strong>${escapeHtml(senderName)}</strong>`,
                companyName ? `<br/>${escapeHtml(companyName)}` : "",
            ].join("")
            : "");

    const textSignature =
        senderName
            ? ["", "", "Best regards,", senderName, companyName ? companyName : ""].join("\n")
            : "";

    return { htmlSignature, textSignature };
}

export function applySignature(
    draft: { text?: string; html?: string },
    sigs: { htmlSignature: string; textSignature: string }
) {
    const out = { ...draft };

    // remove common placeholders the model might have added
    const kill = /\[?\s*your\s*name\s*\]?/gi;
    out.text = out.text?.replace(kill, "").trim();
    out.html = out.html?.replace(kill, "").trim();

    const isNoDraft =
        /^\s*\[NO_DRAFT\]\s*$/i.test(out.text || "") || /^\s*\[NO_DRAFT\]\s*$/i.test(out.html || "");

    if (!isNoDraft) {
        if (out.html) {
            const bare = out.html.replace(/\s+$/g, "");
            if (!looksSigned(stripHtml(bare)) && sigs.htmlSignature) {
                out.html = `${bare}${sigs.htmlSignature}`;
            }
        }
        if (out.text) {
            const bare = out.text.replace(/\s+$/g, "");
            if (!looksSigned(bare) && sigs.textSignature) {
                out.text = `${bare}\n${sigs.textSignature}`;
            }
        }
    }
    return out;
}
