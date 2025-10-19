// apps/web/app/api/healthz/route.ts
import { NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { redis } from "@/lib/redis";

export async function GET() {
    await ensureDb();
    const pong = await redis.ping();
    return NextResponse.json({ ok: true, redis: pong, ts: Date.now() });
}
