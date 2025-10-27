// apps/worker/src/llm.ts
import OpenAI from "openai";

export const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY!,
});

// Helper to call JSON-mode
export async function jsonResponse<T>(args: {
    system: string;
    user: string;
    maxOutputTokens?: number;
}): Promise<T> {
    // Ensure at least one message *explicitly* mentions "json" to satisfy the API requirement.
    const jsonGuard = "You must reply with a single JSON object only. No prose. The output must be valid JSON.";

    const res = await openai.chat.completions.create({
        // Good default small+cheap model; swap to “gpt-4.1-mini” or “o4-mini” if you need more reasoning
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        max_tokens: args.maxOutputTokens ?? 600,
        messages: [
            { role: "system", content: `${jsonGuard}\n\n${args.system}` },
            { role: "user", content: args.user },
        ],
    });

    const content = res.choices[0]?.message?.content ?? "{}";
    try {
        return JSON.parse(content) as T;
    } catch {
        // tolerate ```json fences or stray characters
        const cleaned = content
            .replace(/```json\s*/gi, "")
            .replace(/```/g, "")
            .trim();
        return JSON.parse(cleaned) as T;
    }
}
