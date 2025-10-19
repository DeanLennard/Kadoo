// apps/web/app/api/test/decide/route.ts
import { NextResponse } from "next/server";
import { decisionsQueue } from "@/lib/queues";

export async function POST() {
    await decisionsQueue.add("draft", { threadId: "t1", to: ["alice@example.com"], preview: "Can we meet next Tuesday at 10:00?" });
    return NextResponse.json({ ok: true });
}
