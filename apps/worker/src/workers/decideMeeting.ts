// apps/worker/src/workers/decideMeeting.ts
import { jsonResponse } from "../llm";

export type MeetingDecision =
    | { action: "accept"; reason: string; confidence: number; draft: { subject: string; text: string; html?: string } }
    | { action: "decline"; reason: string; confidence: number; draft: { subject: string; text: string; html?: string } }
    | {
    action: "propose";
    reason: string;
    confidence: number;
    proposals: Array<{ start: string; end: string }>;
    draft: { subject: string; text: string; html?: string };
};

export async function decideMeetingDraft(args: {
    policy: any;              // your tenant policy JSON
    invite: {
        start: string;          // ISO
        end: string;            // ISO
        summary?: string;
        organizer?: string;
        attendees?: { email: string; name?: string }[];
        location?: string;
    };
    busy: Array<{ start: string; end: string; summary?: string }>;
    tz: string;               // e.g., "Europe/London"
}): Promise<MeetingDecision> {
    const system = `You are an Executive Assistant. Decide to accept, decline, or propose alternatives.
- Respect working hours, buffers, no-meeting zones, caps from policy.
- Never send emails; only RETURN a draft (subject + text and optional html).
- Do NOT include any sign-off, closing, or placeholder like "[Your Name]" / "{{name}}".
- Do NOT include the sender's name; we will append a signature later.
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

    return jsonResponse<MeetingDecision>({ system, user, maxOutputTokens: 800 });
}
