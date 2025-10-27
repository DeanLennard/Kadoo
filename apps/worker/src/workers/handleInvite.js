import { col } from "../db";
import { decideMeetingDraft } from "./decideMeeting";
import { parseIcs } from "../adapters/caldav";
import { appendImapDraft } from "./appendImapDraft";
export async function handleInvite({ tenantId, threadId, uid, ics, msg, policy, tz = "Europe/London" }) {
    const invite = parseIcs(ics); // {start,end,summary,organizer,attendees,...}
    // gather same-day busy blocks from DB
    const eventsCol = await col("cal_events");
    const dayStart = new Date(invite.start);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(invite.end);
    dayEnd.setHours(23, 59, 59, 999);
    const busy = await eventsCol.find({
        tenantId,
        start: { $lt: dayEnd }, end: { $gt: dayStart }
    }, { projection: { start: 1, end: 1, summary: 1, _id: 0 } }).toArray();
    // LLM decision that includes a reply draft
    const decision = await decideMeetingDraft({
        policy, invite: {
            start: invite.start.toISOString(),
            end: invite.end.toISOString(),
            summary: invite.summary,
            organizer: invite.organizer,
            attendees: invite.attendees,
            location: invite.location,
        },
        busy,
        tz,
    });
    // Create a Draft doc (no send)
    const draft = {
        _id: `${threadId}:${uid}:meeting:${Date.now()}`,
        tenantId,
        threadId,
        uidRef: uid,
        confidence: decision.confidence ?? 0.7,
        needsApproval: true,
        inReplyToUid: uid,
        subject: decision.draft.subject || (msg.subject?.startsWith("Re:") ? msg.subject : `Re: ${msg.subject ?? ""}`),
        text: decision.draft.text,
        html: decision.draft.html ?? undefined,
        createdAt: new Date(),
        status: "ready",
        meta: {
            kind: "meeting",
            action: decision.action,
            reason: decision.reason,
            proposals: decision.proposals ?? [],
        },
    };
    await (await col("Draft")).insertOne(draft);
    // Put it in the user’s IMAP Drafts so they see it in their client
    await appendImapDraft({ tenantId, threadId, uidRef: uid, draft });
    // Log as a pending decision
    await (await col("DecisionLog")).insertOne({
        tenantId,
        createdAt: new Date(),
        status: "pending",
        requiresApproval: true,
        confidence: decision.confidence,
        action: {
            type: "create_draft_reply",
            payload: {
                threadId,
                to: [msg.from].filter(Boolean),
                subject: draft.subject,
                body_md: draft.text, // your executeWorker already converts/handles
                proposals: decision.proposals ?? [],
                meetingIntent: decision.action, // "accept" | "decline" | "propose"
            },
        },
        context: { invite, busy, policy },
    });
    return decision;
}
