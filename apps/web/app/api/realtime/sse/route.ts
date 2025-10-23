// apps/web/app/api/realtime/sse/route.ts
import { NextResponse } from "next/server";
import Redis from "ioredis";
import { bullConnection } from "@/lib/redis"; // or recreate with REDIS_URL
import { getServerSession } from "next-auth";
import { authConfig } from "@/app/api/auth/[...nextauth]/route";

export const dynamic = "force-dynamic";

export async function GET() {
    const session = await getServerSession(authConfig);
    if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });

    const tenantId = (session as any).tenantId as string;
    const sub = new Redis(process.env.REDIS_URL!, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
    });

    const stream = new ReadableStream({
        start(controller) {
            const send = (x: unknown) => controller.enqueue(`data: ${JSON.stringify(x)}\n\n`);
            sub.subscribe(`tenant:${tenantId}`, (err) => err && controller.error(err));
            sub.on("message", (_ch, msg) => send(JSON.parse(msg)));
            send({ kind: "hello", tenantId });
        },
        cancel() { sub.disconnect(); },
    });

    return new NextResponse(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        },
    });
}
