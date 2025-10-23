// apps/web/app/api/inbox/drafts/route.ts
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { col } from "@/lib/db";
import type { Draft } from "@kadoo/types";

export async function GET(req: Request) {
    const { tenantId } = await requireSession();
    const threadId = new URL(req.url).searchParams.get("threadId")!;
    const drafts = await (await col<Draft>("Draft"))
        .find({ tenantId, threadId })
        .sort({ createdAt: -1 })
        .toArray();
    return NextResponse.json({ items: drafts });
}
