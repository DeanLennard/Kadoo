// apps/worker/src/workers/generateDraft.ts
import { openai } from "../llm";
import type { MailMessage, Draft, TenantSettings } from "@kadoo/types";
import { buildSignatures, applySignature, looksSigned, stripHtml, escapeHtml } from "../util/signature";
import {col} from "../db";

type GenerateArgs = {
    tenantId: string;
    threadId: string;
    uidRef: number;
    msg: MailMessage & { labels?: string[]; summary?: string; priority?: 1 | 2 | 3 };
    subject: string;
    settings: TenantSettings & {
        senderName?: string;
        companyName?: string;
        signatureHtml?: string;
    };
};

function inferConfidence(
    parsed: { text?: string; html?: string },
    msg: { text?: string; html?: string }
): number {
    const out = (parsed.text || parsed.html || "").trim();
    if (/^\[NO_DRAFT\]$/i.test(out)) return 0.1;
    const hadBody = Boolean((msg.text || msg.html || "").trim());
    return hadBody ? 0.75 : 0.55;
}

function normalizeAddresses(val: any): string[] {
    if (!val) return [];
    if (typeof val === "string") return [val];
    if (Array.isArray(val)) {
        // could be strings or { address, name }
        return val
            .map((v) => {
                if (!v) return null;
                if (typeof v === "string") return v;
                if (typeof v === "object" && v.address) return String(v.address);
                return null;
            })
            .filter(Boolean) as string[];
    }
    if (typeof val === "object" && val.address) return [String(val.address)];
    return [];
}

function safeIsoDate(d: unknown): string {
    if (typeof d === "string") return d;
    if (typeof d === "number") return new Date(d).toISOString();
    if (d instanceof Date) return d.toISOString();
    return new Date().toISOString();
}

export async function generateDraft(args: GenerateArgs): Promise<Draft> {
    const { tenantId, threadId, uidRef, msg, subject, settings } = args;

    const toList = normalizeAddresses((msg as any).to);
    const dateIso = safeIsoDate((msg as any).date);

    const replySubject = subject?.toLowerCase().startsWith("re:") ? subject : `Re: ${subject || ""}`;

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
To: ${toList.join(", ")}
Date: ${dateIso}

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

    const sigs = buildSignatures({
        senderName: settings.senderName,
        companyName: settings.companyName,
        signatureHtml: settings.signatureHtml,
    });

    const signed = applySignature(
        { text: parsed.text, html: parsed.html },
        sigs
    );

    const draft: Draft = {
        _id: `${threadId}:${uidRef}:draft:${Date.now()}`,
        tenantId,
        threadId,
        uidRef,
        confidence: inferConfidence(parsed, msg),
        needsApproval: true,
        inReplyToUid: uidRef,
        subject: parsed.subject || replySubject,
        text: signed.text || "",
        html: signed.html,
        createdAt: new Date(),
        status: "ready",
    };

    return draft;
}
