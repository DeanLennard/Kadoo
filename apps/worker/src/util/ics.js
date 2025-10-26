// apps/worker/util/ics.ts
import { DateTime } from 'luxon';
export function buildIcs(opts) {
    const uid = crypto.randomUUID();
    const dt = (d) => DateTime.fromJSDate(d).toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
    const conf = opts.conference ? `\nX-CONFERENCE:${opts.conference}` : '';
    const attendees = opts.attendees.map(a => `ATTENDEE;CN=${a.name ?? a.email};ROLE=REQ-PARTICIPANT:mailto:${a.email}`).join('\n');
    return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Kadoo//EA//EN
BEGIN:VEVENT
UID:${uid}
DTSTAMP:${dt(new Date())}
DTSTART:${dt(opts.start)}
DTEND:${dt(opts.end)}
SUMMARY:${escapeText(opts.summary)}
ORGANIZER:mailto:${opts.organizer}
${attendees}
${opts.location ? `LOCATION:${escapeText(opts.location)}` : ''}
${opts.description ? `DESCRIPTION:${escapeText(opts.description)}` : ''}${conf}
END:VEVENT
END:VCALENDAR`;
}
function escapeText(s) {
    return s.replace(/([,;])/g, '\\$1').replace(/\n/g, '\\n');
}
