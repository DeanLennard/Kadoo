// apps/web/app/api/connectors/calendar/caldav/route.ts (snippet)
import {withApiAuth} from "@/lib/api-auth";
import {col} from "@/lib/db";
import {encrypt} from "@kadoo/server-utils";
import {NextResponse} from "next/server";

function inferHomeFromCalendar(calendarUrl: string) {
    const u = new URL(calendarUrl);
    u.pathname = u.pathname.replace(/\/[^/]+\/?$/, "/");
    return u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`;
}

export const POST = withApiAuth(async (req, { tenantId }) => {
    const body = await req.json();
    const calendarUrl = body.calendarUrl as string;
    const principalUrl = body.principalUrl as (string | undefined);
    const homeUrl = body.homeUrl as (string | undefined);

    const inferredHome = homeUrl ?? inferHomeFromCalendar(calendarUrl);

    await (await col("cal_connectors")).updateOne(
        { tenantId, type: "caldav" },
        {
            $set: {
                tenantId, type: "caldav",
                principalUrl: principalUrl,        // optional, but keep if user knows it
                homeUrl: inferredHome,             // ensures tsdav has a home set
                calendarUrl,
                username: body.username,
                passwordEnc: encrypt(body.password),
                tlsServername: body.tlsServername ?? new URL(calendarUrl).hostname,
                allowSelfSigned: !!body.allowSelfSigned,
                status: "active",
                updatedAt: new Date(),
            },
            $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true }
    );

    return NextResponse.json({ ok: true });
}, ["owner","admin"]);
