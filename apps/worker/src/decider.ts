// apps/worker/src/decider.ts
import OpenAI from "openai";
import { Decision } from "@kadoo/types";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function planDraftReply(input: { threadId: string; to: string[]; preview: string }) {
    const prompt = `Given the preview: "${input.preview}". Produce a friendly UK English draft reply.`;
    const res = await client.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
            { role: "system", content: "Return only markdown body. Keep it concise." },
            { role: "user", content: prompt }
        ]
    });
    const body_md = res.choices[0].message.content ?? "Thanks for your email—I'll get back to you shortly.";
    const decision = {
        policyVersion: "v1",
        confidence: 0.7,
        actions: [{ type: "create_draft_reply", threadId: input.threadId, to: input.to, body_md }]
    };
    return Decision.parse(decision);
}
