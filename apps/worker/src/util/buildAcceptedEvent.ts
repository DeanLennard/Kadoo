// apps/worker/src/util/buildAcceptedEvent.ts
import { Buffer } from "node:buffer";
function fmtStamp(d = new Date()) {
    const pad = (n: number) => String(n).padStart(2, "0");
    const y = d.getUTCFullYear(), m = pad(d.getUTCMonth() + 1), md = pad(d.getUTCDate());
    const h = pad(d.getUTCHours()), mi = pad(d.getUTCMinutes()), s = pad(d.getUTCSeconds());
    return `${y}${m}${md}T${h}${mi}${s}Z`;
}
function toUtc(iso: string | Date) {
    const d = typeof iso === "string" ? new Date(iso) : iso;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}
export function buildAcceptedEvent({
                                       uid, start, end, summary, organizerEmail, attendeeEmail, attendeeName, location,
                                   }: {
    uid: string;
    start: string | Date;
    end: string | Date;
    summary?: string;
    organizerEmail?: string;
    attendeeEmail: string;
    attendeeName?: string;
    location?: string;
}) {
    const dtstamp = fmtStamp();
    const dtstart = toUtc(start);
    const dtend = toUtc(end);
    const cn = attendeeName ? `;CN=${attendeeName}` : "";
    return [
        "BEGIN:VCALENDAR",
        "PRODID:-//Kadoo//EN",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART:${dtstart}`,
        `DTEND:${dtend}`,
        summary ? `SUMMARY:${summary}` : undefined,
        organizerEmail ? `ORGANIZER:mailto:${organizerEmail}` : undefined,
        `ATTENDEE${cn};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:${attendeeEmail}`,
        location ? `LOCATION:${location}` : undefined,
        "END:VEVENT",
        "END:VCALENDAR",
        "",
    ].filter(Boolean).join("\r\n");
}
