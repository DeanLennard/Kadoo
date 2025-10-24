// apps/web/app/api/connectors/calendar/caldav/route.ts
import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-auth";
import { col } from "@/lib/db";
import { encrypt } from "@kadoo/server-utils";

export const POST = withApiAuth(async (req, { tenantId }) => {
    const { principalUrl, calendarUrl, username, password } = await req.json();
    await (await col("cal_connectors")).updateOne(
        { tenantId, type: "caldav" },
        {
            $set: {
                tenantId, type: "caldav",
                principalUrl, calendarUrl, username,
                passwordEnc: encrypt(password),
                status: "active", updatedAt: new Date(),
            },
            $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true }
    );
    return NextResponse.json({ ok: true });
}, ["owner","admin"]);
