// apps/worker/src/workers/classify.ts
import type { MailMessage } from "@kadoo/types";
import { jsonResponse } from "../llm";

export type Classification = {
    isSpam: boolean;
    labels: string[];
    priority: 1 | 2 | 3;
    summary: string;
    dueDateISO?: string;
};

export async function classifyMessage(args: {
    tenantId: string;
    threadId: string;
    msg: MailMessage;
    subject: string;             // <-- add
}): Promise<Classification> {
    const { msg, subject } = args;

    const system = `You are an email triage service. 
- Be precise and conservative with "spam".
- "labels" should be 1-4 lowercase tags from this set when possible: 
  ["spam","newsletter","invoice","billing","support","sales","intro","personal","calendar","legal","hr","ops","shipping","recruiting","partner","product","bug","feature-request"].
- If nothing fits, you may add at most two custom labels.
- priority: 3 only if urgent/blocked/time-sensitive or executive; 1 for low-value newsletters/alerts; else 2.
Return strict JSON only.`;

    const user = `Subject: ${subject || "(no subject)"} 
From: ${msg.from}
To: ${(msg.to || []).join(", ")}
Date: ${new Date(msg.date || Date.now()).toISOString()}

Plain:
${msg.text || ""}

HTML (truncated):
${(msg.html || "").slice(0, 2000)}
`;

    const out = await jsonResponse<Classification>({ system, user });
    out.labels = Array.from(new Set((out.labels || []).map(s => s.toLowerCase()))).slice(0, 5);
    out.isSpam = Boolean(out.isSpam) || out.labels.includes("spam");
    if (![1,2,3].includes(out.priority as any)) out.priority = 2;
    return out;
}
