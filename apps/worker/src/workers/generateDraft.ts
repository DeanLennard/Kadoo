// apps/worker/src/workers/generateDraft.ts
import { openai } from "../llm";
import type { MailMessage, Draft, TenantSettings } from "@kadoo/types";

type GenerateArgs = {
    tenantId: string;
    threadId: string;
    uidRef: number;
    msg: MailMessage & { labels?: string[]; summary?: string; priority?: 1|2|3 };
    subject: string;                 // <-- add
    settings: TenantSettings & { senderName?: string; signatureHtml?: string };
};

function inferConfidence(
    parsed: { text?: string; html?: string },
    msg: { text?: string; html?: string }
): number {
    // Very simple heuristic to start:
    // - If model returned [NO_DRAFT], confidence is very low.
    // - If body was empty and it still produced text, keep it modest.
    const out = (parsed.text || parsed.html || "").trim();
    if (/^\[NO_DRAFT\]$/i.test(out)) return 0.1;

    const hadBody = Boolean((msg.text || msg.html || "").trim());
    return hadBody ? 0.75 : 0.55; // tweak as you learn
}

export async function generateDraft(args: GenerateArgs): Promise<Draft> {
    const { tenantId, threadId, uidRef, msg, subject, settings } = args;

    const signatureHtml = settings.signatureHtml || "";
    const from = settings.senderName || (msg.to?.[0] ?? "Team");
    const replySubject = subject.startsWith("Re:") ? subject : `Re: ${subject || ""}`;

    const system = `You write short, clear professional email replies. 
- Keep it under 8 sentences unless necessary.
- Use UK spelling if ambiguous.
- Ask exactly one question if clarification is needed.
- Never include tracking pixels or external images.
- Do not invent facts.`;

    const user = `Compose a concise reply to the following email.
Prefer helpful, friendly-neutral tone. 
If the email is clearly spam or automated no thanks, write: "[NO_DRAFT]".
Add a bullet list only if it materially improves clarity.

Original:
Subject: ${subject || "(no subject)"}
From: ${msg.from}
To: ${(msg.to || []).join(", ")}
Date: ${new Date(msg.date || Date.now()).toISOString()}

Plain:
${msg.text || ""}

HTML (truncated):
${(msg.html || "").slice(0, 3000)}

If appropriate, include a brief subject tweak (<=65 chars). Return as JSON:
{
  "subject": "Re: ...",
  "text": "...",
  "html": "..."
}`;

    const res = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.3,
        response_format: { type: "json_object" },
        max_tokens: 800,
        messages: [
            { role: "system", content: system },
            { role: "user", content: user },
        ],
    });

    const raw = res.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw) as { subject?: string; text?: string; html?: string };

    if (!parsed.html && !parsed.text) parsed.text = "[NO_DRAFT]";

    let html = parsed.html || "";
    let text = parsed.text || "";
    if (signatureHtml && !/^\s*\[NO_DRAFT\]\s*$/.test(text)) {
        html = `${html}\n\n${signatureHtml}`;
        text = `${text}\n\n-- \n${from}`;
    }

    const draft: Draft = {
        _id: `${threadId}:${uidRef}:draft:${Date.now()}`,
        tenantId,
        threadId,
        uidRef,
        confidence: inferConfidence(parsed, msg),
        needsApproval: true,
        inReplyToUid: uidRef,
        subject: parsed.subject || replySubject,
        text,
        html,
        createdAt: new Date(),
        status: "ready",
    };

    return draft;
}
