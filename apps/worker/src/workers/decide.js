export function decideAction(args) {
    const { msg, subject, settings } = args;
    if (msg.isSpam)
        return { kind: "none" };
    if (!settings.autoDraft)
        return { kind: "none" };
    const labels = new Set(msg.labels || []);
    const subj = (subject || "").toLowerCase();
    const shouldDraft = labels.has("support") ||
        labels.has("sales") ||
        labels.has("invoice") ||
        subj.includes("quote") ||
        subj.includes("pricing") ||
        subj.includes("question") ||
        (msg.priority || 2) >= 3;
    if (!shouldDraft)
        return { kind: "none" };
    const tone = (labels.has("legal") || labels.has("billing")) ? "formal"
        : labels.has("support") ? "friendly"
            : "neutral";
    return { kind: "draft", tone };
}
