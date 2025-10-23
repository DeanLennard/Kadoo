// apps/web/app/api/test/enqueue/route.ts
import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-auth";
import { Queue } from "bullmq";
import Redis from "ioredis";

const connection = new Redis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
});

const eventsQ = new Queue("events", { connection });

export const POST = withApiAuth(async (_req, { tenantId }) => {
    await eventsQ.add(
        "demoEvent",
        { tenantId, hello: "world", ts: Date.now() },
        { removeOnComplete: true }
    );
    return NextResponse.json({ ok: true });
});
