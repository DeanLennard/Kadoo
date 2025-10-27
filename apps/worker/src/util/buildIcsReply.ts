// apps/worker/src/util/buildIcsReply.ts
export function buildIcsReply({
                                  uid,
                                  organizerEmail,
                                  attendeeEmail,
                                  attendeeName,
                                  summary,
                                  start,  // ISO string (UTC, with Z)
                                  end,    // ISO string (UTC, with Z)
                              }: {
    uid: string;
    organizerEmail: string;
    attendeeEmail: string;
    attendeeName?: string;
    summary?: string;
    start?: string;
    end?: string;
}) {
    const dtstamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace(/T/, "T");
    const toCal = (iso?: string) =>
        iso ? iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace(/T/, "T") : undefined;

    const DTSTART = start ? `DTSTART:${toCal(start)}\r\n` : "";
    const DTEND   = end   ? `DTEND:${toCal(end)}\r\n`   : "";

    return [
        "BEGIN:VCALENDAR",
        "PRODID:-//Kadoo//EN",
        "VERSION:2.0",
        "METHOD:REPLY",
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${dtstamp}`,
        "SEQUENCE:0",
        summary ? `SUMMARY:${summary}` : "",
        `ORGANIZER:mailto:${organizerEmail}`,
        `ATTENDEE;CN=${(attendeeName || attendeeEmail).replace(/[,;]/g, " ")};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:${attendeeEmail}`,
        DTSTART,
        DTEND,
        "END:VEVENT",
        "END:VCALENDAR",
        ""
    ].filter(Boolean).join("\r\n");
}
