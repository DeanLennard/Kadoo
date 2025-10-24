// apps/web/app/api/inbox/threads/route.ts
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { col } from "@/lib/db";
import type { MailThread } from "@kadoo/types";

export async function GET(req: Request) {
    const { tenantId } = await requireSession();
    const { searchParams } = new URL(req.url);
    const folder = searchParams.get("folder") || "INBOX";

    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const threads = await (await col<MailThread>("MailThread"))
        .find({ tenantId, folder, lastTs: { $gte: since } })
        .project({ _id: 1, subject: 1, participants: 1, lastTs: 1, unread: 1, labels: 1 })
        .sort({ lastTs: -1 })
        .limit(200)
        .toArray();

    // No bodies here; UI loads the thread view separately
    return NextResponse.json({ items: threads });
}
