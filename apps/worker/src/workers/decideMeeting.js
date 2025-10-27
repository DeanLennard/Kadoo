// apps/worker/src/workers/decideMeeting.ts
import { jsonResponse } from "../llm";
export async function decideMeetingDraft(args) {
    const system = `You are an Executive Assistant. Decide to accept, decline, or propose alternatives.
- Respect working hours, buffers, no-meeting zones, caps from policy.
- Never send emails; only RETURN a draft (subject + text and optional html).
- If "propose", include 2–3 candidate slots that are open in the given busy data.
- Use the supplied timezone when wording dates/times. Keep replies concise (<=8 sentences).`;
    const user = JSON.stringify({
        policy: args.policy,
        invite: args.invite,
        busy: args.busy,
        tz: args.tz,
        output_schema: {
            action: "accept|decline|propose",
            reason: "string",
            confidence: "0-1",
            proposals: "[{start,end}] when action='propose'",
            draft: "{subject,text,html?} (the email reply, do not send)",
        },
    });
    return jsonResponse({ system, user, maxOutputTokens: 800 });
}
