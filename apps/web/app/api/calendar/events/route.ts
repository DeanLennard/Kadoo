// apps/web/app/api/calendar/events/route.ts
import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-auth";
import { col } from "@/lib/db";

export const GET = withApiAuth(async (req, { tenantId }) => {
    const url = new URL(req.url);
    const days = Number(url.searchParams.get("days") ?? 14);
    const now = new Date();
    const end = new Date(now.getTime() + days * 24*3600*1000);

    const events = await (await col<any>("cal_events"))
        .find({ tenantId, start: { $lt: end }, end: { $gt: now } })
        .project({ start:1, end:1, summary:1 })
        .toArray();

    return NextResponse.json({ events });
}, ["owner","admin","reviewer","viewer"]);
