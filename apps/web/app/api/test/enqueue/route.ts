// apps/web/app/api/test/enqueue/route.ts
import { NextResponse } from "next/server";
import { Queue } from "bullmq";
import Redis from "ioredis";

const url = process.env.REDIS_URL || "redis://localhost:6379/0";
const connection = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
});

export async function POST() {
    const events = new Queue("events", { connection });
    await events.add("demoEvent", { hello: "world", ts: Date.now() }, { removeOnComplete: true });
    return NextResponse.json({ ok: true });
}
