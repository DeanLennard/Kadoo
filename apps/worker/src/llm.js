// apps/worker/src/llm.ts
import OpenAI from "openai";
export const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});
// Helper to call JSON-mode
export async function jsonResponse(args) {
    const res = await openai.chat.completions.create({
        // Good default small+cheap model; swap to “gpt-4.1-mini” or “o4-mini” if you need more reasoning
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        max_tokens: args.maxOutputTokens ?? 600,
        messages: [
            { role: "system", content: args.system },
            { role: "user", content: args.user },
        ],
    });
    const content = res.choices[0]?.message?.content || "{}";
    return JSON.parse(content);
}
