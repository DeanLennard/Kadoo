// apps/worker/src/adapters/caldav.ts
import http from "node:http";
import https from "node:https";
import * as TSDAV from "tsdav";
import ICAL from "ical.js";
const collectionSync = (TSDAV.collectionSync ?? TSDAV.default);
// Then use TSDAV’s other named exports as normal:
const { calendarMultiGet, fetchCalendarObjects, createCalendarObject, updateCalendarObject, deleteCalendarObject, } = TSDAV;
function inferPaths(conn) {
    const cal = new URL(conn.calendarUrl);
    const origin = `${cal.protocol}//${cal.host}`;
    const homeUrl = conn.homeUrl ?? cal.pathname.replace(/\/[^/]+\/?$/, "/"); // strip last segment
    const principalUrl = conn.principalUrl ?? `/principals/users/${encodeURIComponent(conn.username)}/`;
    return { origin, homeUrl, principalUrl };
}
export function makeAgentForUrl(urlStr, opts) {
    const u = new URL(urlStr);
    if (u.protocol === "http:") {
        return new http.Agent({
            keepAlive: true,
            maxSockets: 50,
        });
    }
    // https:
    return new https.Agent({
        keepAlive: true,
        servername: opts.tlsServername || u.hostname,
        rejectUnauthorized: !(opts.allowSelfSigned ?? false),
        maxSockets: 50,
    });
}
function authHeaders(username, password) {
    const b64 = Buffer.from(`${username}:${password}`).toString("base64");
    return { Authorization: `Basic ${b64}` };
}
export function normaliseCalUrl(raw) {
    const u = new URL(raw);
    // If using TLS on 8008, switch to HTTP
    if (u.protocol === "https:" && u.port === "8008") {
        u.protocol = "http:";
    }
    // If using HTTP on 8443, switch to HTTPS
    if (u.protocol === "http:" && u.port === "8443") {
        u.protocol = "https:";
    }
    // ensure trailing slash for collection
    if (!u.pathname.endsWith("/"))
        u.pathname += "/";
    return u.toString();
}
function basicAuthHeader(user, pass) {
    const b64 = Buffer.from(`${user}:${pass}`).toString("base64");
    return `Basic ${b64}`;
}
function buildAccount(conn) {
    const cal = new URL(conn.calendarUrl);
    const origin = `${cal.protocol}//${cal.host}`;
    const homeUrl = conn.homeUrl ?? cal.pathname.replace(/\/[^/]+\/?$/, "/");
    const principalUrl = conn.principalUrl ?? `/principals/users/${encodeURIComponent(conn.username)}/`;
    return { serverUrl: conn.serverUrl ?? origin, homeUrl, principalUrl };
}
// ---- Delta listing (sync-token if server supports it) ----
export async function listDelta(conn, known = []) {
    const calUrl = normaliseCalUrl(conn.calendarUrl);
    const agent = makeAgentForUrl(calUrl, {
        tlsServername: conn.tlsServername,
        allowSelfSigned: conn.allowSelfSigned,
    });
    const headers = authHeaders(conn.username, conn.password);
    try {
        const res = await collectionSync({
            collection: { url: calUrl },
            objects: known,
            objectMultiGet: calendarMultiGet,
            priorSyncToken: conn.syncToken,
            fetchOptions: { agent, headers },
            detailedResult: true,
        });
        return {
            created: res.objects.created ?? [],
            updated: res.objects.updated ?? [],
            deleted: (res.objects.deleted ?? []).map((o) => o.url),
            newSyncToken: res.syncToken,
        };
    }
    catch {
        const now = Date.now();
        const startISO = new Date(now - 24 * 3600_000).toISOString();
        const endISO = new Date(now + 30 * 24 * 3600_000).toISOString();
        const objs = await fetchCalendarObjects({
            calendar: { url: calUrl },
            timeRange: { start: startISO, end: endISO },
            expand: true,
            fetchOptions: { agent, headers },
        });
        return { created: [], updated: objs, deleted: [], newSyncToken: undefined };
    }
}
export async function listRange(conn, startISO, endISO) {
    const calUrl = normaliseCalUrl(conn.calendarUrl);
    const agent = makeAgentForUrl(calUrl, {
        tlsServername: conn.tlsServername,
        allowSelfSigned: conn.allowSelfSigned,
    });
    const headers = authHeaders(conn.username, conn.password);
    // give slower CalDAVs more breathing room
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 30_000); // was 15s → 30s
    try {
        console.log("[caldav.adapter] listRange", { calUrl, startISO, endISO });
        const objs = await fetchCalendarObjects({
            calendar: { url: calUrl },
            // First try with no filter at all — some servers only return data this way.
            fetchOptions: { agent, signal: ac.signal, headers },
        });
        if (!objs?.length) {
            const wideStart = new Date(Date.now() - 365 * 86400_000).toISOString();
            const wideEnd = new Date(Date.now() + 365 * 86400_000).toISOString();
            const withWindow = await fetchCalendarObjects({
                calendar: { url: calUrl },
                timeRange: { start: wideStart, end: wideEnd },
                fetchOptions: { agent, signal: ac.signal, headers },
            });
            return withWindow;
        }
        console.log("[caldav.adapter] listRange ok", { count: objs?.length ?? 0 });
        return objs;
    }
    finally {
        clearTimeout(t);
    }
}
export async function upsertEvent(conn, ics, href) {
    const targetUrl = href ?? normaliseCalUrl(conn.calendarUrl);
    const agent = makeAgentForUrl(targetUrl, {
        tlsServername: conn.tlsServername,
        allowSelfSigned: conn.allowSelfSigned,
    });
    const headers = authHeaders(conn.username, conn.password);
    if (href) {
        await updateCalendarObject({
            calendarObject: { url: href, data: ics },
            fetchOptions: { agent, headers },
        });
        return href;
    }
    const created = await createCalendarObject({
        calendar: { url: targetUrl },
        filename: `${crypto.randomUUID()}.ics`,
        iCalString: ics,
        fetchOptions: { agent, headers },
    });
    return created?.url ?? `${targetUrl.replace(/\/$/, "")}/${crypto.randomUUID()}.ics`;
}
export async function removeEvent(conn, href) {
    const agent = makeAgentForUrl(href, {
        tlsServername: conn.tlsServername,
        allowSelfSigned: conn.allowSelfSigned,
    });
    const headers = authHeaders(conn.username, conn.password);
    await deleteCalendarObject({
        calendarObject: { url: href },
        fetchOptions: { agent, headers },
    });
}
export async function listCollections(homeUrl, auth, opts) {
    const url = homeUrl.endsWith("/") ? homeUrl : homeUrl + "/";
    const headers = {
        Depth: "1",
        Authorization: "Basic " + Buffer.from(`${auth.username}:${auth.password}`, "utf8").toString("base64"),
        "Content-Type": "text/xml; charset=utf-8",
    };
    // Minimal propfind body to list collections
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:displayname/>
    <D:resourcetype/>
  </D:prop>
</D:propfind>`;
    const res = await fetch(url, {
        method: "PROPFIND",
        headers,
        body,
        // pass through your http/https agent so SNI/self-signed rules apply
        ...(opts?.agent ? { agent: opts.agent } : {}),
    });
    const text = await res.text(); // keep raw; some servers return non-XML on proxy
    return { status: res.status, body: text };
}
// ---- ICS parse helper (unchanged) ----
export function parseIcs(ics) {
    const jcal = ICAL.parse(ics);
    const comp = new ICAL.Component(jcal);
    const vevent = comp.getFirstSubcomponent("vevent");
    if (!vevent)
        throw new Error("No VEVENT in iCalendar data");
    const event = new ICAL.Event(vevent);
    const toStr = (v) => (typeof v === "string" ? v : v?.toString?.() ?? "");
    const attendeesProps = (vevent.getAllProperties("attendee") ?? []);
    const organizerRaw = vevent.getFirstPropertyValue("organizer");
    const organizer = toStr(organizerRaw).replace(/^mailto:/i, "");
    return {
        uid: event.uid,
        start: event.startDate.toJSDate(),
        end: event.endDate.toJSDate(),
        summary: event.summary || "",
        location: event.location || "",
        attendees: attendeesProps.map((p) => {
            const v = p.getFirstValue();
            const email = toStr(v).replace(/^mailto:/i, "");
            const name = p.getParameter?.("cn") || undefined;
            return { email, name };
        }),
        organizer,
    };
}
