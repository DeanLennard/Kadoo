// apps/worker/src/workers/decide.ts
import type { TenantSettings } from "@kadoo/types";
import type { Classification } from "./classify";
import type { MailMessage } from "@kadoo/types";

export type Decision =
    | { kind: "none" }
    | { kind: "draft"; tone: "friendly" | "formal" | "neutral" };

export function decideAction(args: {
    msg: MailMessage & Partial<Classification>;
    subject: string;                  // <-- add
    settings: TenantSettings;
}): Decision {
    const { msg, subject, settings } = args;

    if (msg.isSpam) return { kind: "none" };
    if (!settings.autoDraft) return { kind: "none" };

    const labels = new Set(msg.labels || []);
    const subj = (subject || "").toLowerCase();

    const shouldDraft =
        labels.has("support") ||
        labels.has("sales") ||
        labels.has("invoice") ||
        subj.includes("quote") ||
        subj.includes("pricing") ||
        subj.includes("question") ||
        (msg.priority || 2) >= 3;

    if (!shouldDraft) return { kind: "none" };

    const tone: "friendly" | "formal" | "neutral" =
        (labels.has("legal") || labels.has("billing")) ? "formal"
            : labels.has("support") ? "friendly"
                : "neutral";

    return { kind: "draft", tone };
}
