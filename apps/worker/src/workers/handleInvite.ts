// apps/worker/src/workers/handleInvite.ts
import type { TenantSettings, Draft } from "@kadoo/types";
import { col } from "../db";
import { parseIcs } from "../adapters/caldav";
import { decisionsQueue } from "../queues";
import { buildSignatures, applySignature } from "../util/signature";
import { getActiveEA, canAcceptInvites } from "../util/employee";

type ISO = string;
type BusyBlock = { start: string | Date; end: string | Date; summary?: string };

function toDate(d: string | Date) { return d instanceof Date ? d : new Date(d); }
function addMin(date: Date, m: number) { return new Date(+date + m * 60_000); }
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
    return aStart < bEnd && aEnd > bStart;
}

function withinWorkingHours(start: Date, end: Date, policy: any, tz: string) {
    // NOTE: This uses system time; if you keep tz-aware helpers elsewhere, swap them in.
    const [sh, sm] = (policy?.workingHours?.start ?? "09:00").split(":").map(Number);
    const [eh, em] = (policy?.workingHours?.end ?? "17:30").split(":").map(Number);
    const sH = start.getHours(), sM = start.getMinutes();
    const eH = end.getHours(), eM = end.getMinutes();
    const startsOK = (sH > sh || (sH === sh && sM >= sm));
    const endsOK   = (eH < eh || (eH === eh && eM <= em));
    return startsOK && endsOK;
}

function isAllowedInvite(invite: { start: Date; end: Date }, busy: BusyBlock[], policy: any) {
    const bufferMin = policy?.buffers?.beforeAfterMin ?? 0;
    const minNotice = policy?.minNoticeMin ?? 0;

    const now = new Date();
    if (invite.start < addMin(now, minNotice)) return false;

    const s = addMin(invite.start, -bufferMin);
    const e = addMin(invite.end,   +bufferMin);

    const clash = busy.some(b => overlaps(s, e, toDate(b.start), toDate(b.end)));
    if (clash) return false;

    if (!withinWorkingHours(invite.start, invite.end, policy, "Europe/London")) return false;

    return true;
}

function mergeIntervals(blocks: Array<{ start: Date; end: Date }>) {
    if (!blocks.length) return [];
    const sorted = blocks
        .map(b => ({ start: new Date(b.start), end: new Date(b.end) }))
        .sort((a, b) => a.start.getTime() - b.start.getTime());
    const out: Array<{ start: Date; end: Date }> = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
        const last = out[out.length - 1];
        const cur = sorted[i];
        if (cur.start <= last.end) {
            if (cur.end > last.end) last.end = cur.end;
        } else {
            out.push(cur);
        }
    }
    return out;
}

function computeWorkingWindow(inviteStart: Date, policy: any) {
    // window is the working hours of *that day*
    const [sh, sm] = (policy?.workingHours?.start ?? "09:00").split(":").map(Number);
    const [eh, em] = (policy?.workingHours?.end ?? "17:30").split(":").map(Number);
    const day = new Date(inviteStart);
    const ws = new Date(day); ws.setHours(sh, sm, 0, 0);
    const we = new Date(day); we.setHours(eh, em, 0, 0);
    return { ws, we };
}

function clampToWorkingHours(intervals: Array<{ start: Date; end: Date }>, ws: Date, we: Date) {
    return intervals
        .map(b => ({
            start: b.start < ws ? ws : b.start,
            end:   b.end   > we ? we : b.end,
        }))
        .filter(b => b.start < b.end);
}

function invertBusyToFree(ws: Date, we: Date, mergedBusy: Array<{ start: Date; end: Date }>) {
    const free: Array<{ start: Date; end: Date }> = [];
    let cursor = new Date(ws);
    for (const b of mergedBusy) {
        if (cursor < b.start) free.push({ start: new Date(cursor), end: new Date(b.start) });
        if (cursor < b.end) cursor = new Date(b.end);
    }
    if (cursor < we) free.push({ start: new Date(cursor), end: new Date(we) });
    return free;
}

function computeProposals(args: {
    inviteStart: Date;
    inviteEnd: Date;
    busy: BusyBlock[];
    policy: any;
    max: number; // 2 or 3
}): Array<{ start: ISO; end: ISO }> {
    const bufferMin = args.policy?.buffers?.beforeAfterMin ?? 0;
    const minNotice = args.policy?.minNoticeMin ?? 0;
    const durationMs = +args.inviteEnd - +args.inviteStart;

    const { ws, we } = computeWorkingWindow(args.inviteStart, args.policy);

    // Build "blocked" intervals = busy + notice gate at (now + minNotice)
    const nowBarrier = addMin(new Date(), minNotice);
    const blocked: Array<{ start: Date; end: Date }> = [];

    // gate before now+notice
    blocked.push({ start: new Date(ws), end: nowBarrier > ws ? (nowBarrier < we ? nowBarrier : we) : ws });

    // busy with buffer
    for (const b of args.busy) {
        const s = addMin(toDate(b.start), -bufferMin);
        const e = addMin(toDate(b.end),   +bufferMin);
        blocked.push({ start: s, end: e });
    }

    // merge and clamp
    const merged = mergeIntervals(blocked);
    const clamped = clampToWorkingHours(merged, ws, we);

    // free windows
    const free = invertBusyToFree(ws, we, clamped);

    // choose first N windows that can fit duration
    const out: Array<{ start: ISO; end: ISO }> = [];
    for (const f of free) {
        let slotStart = new Date(f.start);
        // align earliest start to respect buffer-min already baked into blocked
        while (slotStart < f.end) {
            const slotEnd = new Date(+slotStart + durationMs);
            if (slotEnd <= f.end) {
                out.push({ start: slotStart.toISOString(), end: slotEnd.toISOString() });
                if (out.length >= args.max) return out;
                // step forward by duration to avoid overlapping proposals (or add a small gap, e.g., 10m)
                slotStart = new Date(+slotStart + durationMs);
            } else {
                break;
            }
        }
        if (out.length >= args.max) break;
    }
    return out;
}

export async function handleInvite({
                                       tenantId, threadId, uid, ics, msg, policy, tz = "Europe/London"
                                   }: {
    tenantId: string;
    threadId: string;
    uid: number;
    ics?: string;
    msg: { subject?: string; from?: string; date?: string | number };
    policy: any;
    tz?: string;
}) {

    if (!ics) throw new Error("handleInvite called without ICS");
    const invite = parseIcs(ics); // returns Dates for start/end (per your existing code)

    const emp = await getActiveEA(tenantId);
    const eaHasPermission = canAcceptInvites(emp);

    // gather same-day busy blocks from DB
    const eventsCol = await col<any>("cal_events");
    const dayStart = new Date(invite.start); dayStart.setHours(0, 0, 0, 0);
    const dayEnd   = new Date(invite.end);   dayEnd.setHours(23, 59, 59, 999);

    const busy: BusyBlock[] = await eventsCol.find(
        { tenantId, start: { $lt: dayEnd }, end: { $gt: dayStart } },
        { projection: { start: 1, end: 1, summary: 1, _id: 0 } }
    ).toArray();

    // ---- Deterministic decision (accept vs propose) ----
    const inviteObj = { start: invite.start, end: invite.end };
    const allowed = isAllowedInvite(inviteObj, busy, policy);

    let confidence = allowed ? 0.98 : 0.90;
    const whenStr = `${invite.start.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}–${invite.end.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})} on ${invite.start.toLocaleDateString("en-GB")}`;

    const settingsCol = await col<TenantSettings>("TenantSettings");
    const settings = (await settingsCol.findOne({ tenantId })) || ({ tenantId, autoDraft: true, autoSend: false } as TenantSettings);
    const sigs = buildSignatures({
        senderName: (settings as any).senderName,
        companyName: (settings as any).companyName,
        signatureHtml: (settings as any).signatureHtml,
    });

    const subject = msg.subject?.startsWith("Re:") ? msg.subject! : `Re: ${msg.subject ?? invite.summary ?? "Meeting"}`;

    if (!emp?.enabled) {
        // Optionally emit an SSE so the dashboard shows that we ignored it
        // await emit(tenantId, { kind: "action_denied", reason: "ea_disabled_or_no_permission", action: "send_calendar_reply" });
        return { action: "accept", confidence, queued: "ignored_ea_off" } as const;
    }

    if (allowed) {
        const text = `Thanks for the invitation — ${whenStr} works for me.`;
        const signed = applySignature({ text, html: `<p>${text}</p>` }, sigs);

        // If EA missing/disabled/no permission → create PENDING decision log and stop
        if (!eaHasPermission) {
            await (await col("DecisionLog")).insertOne({
                tenantId,
                createdAt: new Date(),
                status: "pending",
                requiresApproval: true,
                confidence,
                reason: !emp ? "ea_missing" : "ea_disabled_or_no_permission",
                action: {
                    type: "send_calendar_reply",
                    payload: {
                        threadId,
                        to: [msg.from].filter(Boolean),
                        subject,
                        body_md: signed.text,
                        body_html: signed.html,
                        ics_uid: invite.uid,
                        ics_summary: invite.summary,
                        ics_organizer: invite.organizer,
                        start: invite.start.toISOString(),
                        end: invite.end.toISOString(),
                        location: invite.location,
                        attendee_name: (settings as any).senderName,
                    },
                },
                context: { invite, busy, policy },
            });
            return { action: "accept", confidence, queued: "pending_decision" } as const;
        }

        // Else: enqueue a decision; decisionsWorker will honour auto flags/thresholds and either approve+execute or leave pending.
        await decisionsQueue.add(
            "plan",
            {
                tenantId,
                threadId,
                decision: {
                    actionType: "send_calendar_reply" as const,
                    confidence,
                    payload: {
                        to: [msg.from].filter(Boolean),
                        subject,
                        body_md: signed.text,
                        body_html: signed.html,
                        ics_uid: invite.uid,
                        ics_summary: invite.summary,
                        ics_organizer: invite.organizer,
                        start: invite.start.toISOString(),
                        end: invite.end.toISOString(),
                        location: invite.location,
                        attendee_name: (settings as any).senderName,
                    },
                },
            },
            { removeOnComplete: true, removeOnFail: 50 }
        );

        return { action: "accept", confidence, queued: "decisions" } as const;
    }

    // PROPOSE path
    const proposals = computeProposals({
        inviteStart: invite.start,
        inviteEnd: invite.end,
        busy,
        policy,
        max: 3,
    });

    const fmt = (iso: string) => {
        const d = new Date(iso);
        return `${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} on ${d.toLocaleDateString("en-GB")}`;
    };
    const list = proposals.map(p => `• ${fmt(p.start)}`).join("\n");
    const text = proposals.length
        ? `Thanks for the invitation. I can’t make the proposed time, but these would work for me:\n\n${list}\nPlease let me know if any of these suit.`
        : `Thanks for the invitation. I can’t make the proposed time — could you share a couple of alternative slots later that day or the next, and I’ll confirm?`;

    const signed = applySignature({ text, html: `<p>${text.replace(/\n/g, "<br/>")}</p>` }, sigs);

    // For proposals we create a *draft reply* decision. DO NOT append IMAP draft here.
    await (await col("DecisionLog")).insertOne({
        tenantId,
        createdAt: new Date(),
        status: "pending",
        requiresApproval: true,
        confidence,
        action: {
            type: "create_draft_reply",
            payload: {
                threadId,
                to: [msg.from].filter(Boolean),
                subject,
                body_md: signed.text,
                meetingIntent: "propose",
                proposals,
            },
        },
        context: {
            invite: {
                start: invite.start.toISOString(),
                end: invite.end.toISOString(),
                summary: invite.summary,
                organizer: invite.organizer,
                attendees: invite.attendees,
                location: invite.location,
            },
            busy,
            policy,
        },
    });

    // (Optional) If you prefer the decisions pipeline to decide auto-draft vs pending:
    // await decisionsQueue.add("plan", { tenantId, threadId, decision: { actionType: "send_reply", confidence, payload: {...} } });

    return { action: "propose", confidence, queued: "pending_decision" } as const;
}
