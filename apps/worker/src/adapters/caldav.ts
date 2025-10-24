// apps/worker/adapters/caldav.ts
import {
    createDAVClient,
    fetchCalendarObjects,
    createCalendarObject,
    updateCalendarObject,
    deleteCalendarObject,
} from "tsdav";
import ICAL from "ical.js";

type Conn = {
    principalUrl: string;
    calendarUrl: string;
    username: string;
    password: string;
    syncToken?: string; // server-provided token from previous sync
};

export type CalObj = { url: string; etag?: string; data?: string };

async function clientFrom(conn: Conn) {
    return createDAVClient({
        serverUrl: conn.principalUrl,
        credentials: { username: conn.username, password: conn.password },
        authMethod: "Basic",
        defaultAccountType: "caldav",
    });
}

/**
 * Proper delta sync using client.smartCollectionSync
 * known: your local cache of { url, etag } for that calendar.
 */
export async function listDelta(
    conn: Conn,
    known: { url: string; etag?: string }[] = []
): Promise<{
    created: CalObj[];
    updated: CalObj[];
    deleted: string[];           // <-- hrefs only
    newSyncToken?: string;
}> {
    const client = await clientFrom(conn);

    const res = await client.smartCollectionSync({
        collection: {
            url: conn.calendarUrl,
            syncToken: conn.syncToken,
            objects: known,
            objectMultiGet: client.calendarMultiGet,
        },
        method: "webdav",
        detailedResult: true,
    });

    const { created = [], updated = [], deleted = [] } = res.objects ?? {};
    return {
        created: created as CalObj[],
        updated: updated as CalObj[],
        deleted: (deleted as CalObj[]).map(o => o.url),   // <-- map to hrefs
        newSyncToken: res.syncToken,
    };
}

/**
 * Simple range fetch (portable) — keeps working as before.
 */
export async function listRange(conn: Conn, startISO: string, endISO: string) {
    const client = await clientFrom(conn);
    const objs = await fetchCalendarObjects({
        calendar: { url: conn.calendarUrl } as any,
        timeRange: { start: startISO, end: endISO },
        expand: true,
    });
    return objs;
}

export async function upsertEvent(conn: Conn, ics: string, href?: string) {
    const client = await clientFrom(conn);
    if (href) {
        await updateCalendarObject({ calendarObject: { url: href, data: ics } as any });
        return href;
    }
    const filename = `${crypto.randomUUID()}.ics`;
    const created = await createCalendarObject({
        calendar: { url: conn.calendarUrl } as any,
        iCalString: ics,
        filename,
    });
    return (created as any)?.url ?? `${conn.calendarUrl.replace(/\/$/, "")}/${filename}`;
}

export async function removeEvent(conn: Conn, href: string) {
    const client = await clientFrom(conn);
    await deleteCalendarObject({ calendarObject: { url: href } as any });
}

// ---- ICS parsing helper (safe) ----
export function parseIcs(ics: string) {
    const jcal = ICAL.parse(ics);
    const comp = new ICAL.Component(jcal);
    const vevent = comp.getFirstSubcomponent("vevent");
    if (!vevent) throw new Error("No VEVENT in iCalendar data");

    const event = new (ICAL as any).Event(vevent as any);

    const toStr = (v: unknown) => (typeof v === "string" ? v : (v as any)?.toString?.() ?? "");
    const attendeesProps = (vevent.getAllProperties("attendee") ?? []) as any[];
    const organizerRaw = vevent.getFirstPropertyValue("organizer");
    const organizer = toStr(organizerRaw).replace(/^mailto:/i, "");

    return {
        uid: event.uid,
        start: event.startDate.toJSDate(),
        end: event.endDate.toJSDate(),
        summary: event.summary || "",
        location: event.location || "",
        attendees: attendeesProps.map((p: any) => {
            const v = p.getFirstValue();
            const email = toStr(v).replace(/^mailto:/i, "");
            const name = p.getParameter?.("cn") || undefined;
            return { email, name };
        }),
        organizer,
    };
}
