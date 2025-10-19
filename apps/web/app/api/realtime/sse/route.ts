// apps/web/app/api/realtime/sse/route.ts
import { NextResponse } from "next/server";
import Redis from "ioredis";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";

export async function GET() {
    const sub = new Redis(redis.options as any);
    const stream = new ReadableStream({
        start(controller) {
            const send = (msg: string) => controller.enqueue(`data: ${msg}\n\n`);
            sub.subscribe("tenant:demo", (err) => { if (err) controller.error(err); });
            sub.on("message", (_ch, message) => send(message));
        },
        cancel() { sub.disconnect(); }
    });
    return new NextResponse(stream, {
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" }
    });
}
