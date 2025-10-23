// apps/web/app/api/inbox/thread/route.ts
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { col } from "@/lib/db";
import type { MailThread, MailMessage } from "@kadoo/types";

export async function GET(req: Request) {
    const { tenantId } = await requireSession();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const threads = await col<MailThread>("MailThread");
    const t = await threads.findOne({ _id: id, tenantId });
    if (!t) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const msgs = await (await col<MailMessage>("MailMessage"))
        .find({ tenantId, threadId: id })
        .project({
            _id: 1,
            from: 1,
            to: 1,
            date: 1,
            uid: 1,
            text: 1,
            html: 1,
            folder: 1,
            attachments: 1,
        })
        .sort({ date: 1 })
        .toArray();

    return NextResponse.json({
        thread: { _id: t._id, subject: t.subject, participants: t.participants, folder: (t as any).folder },
        messages: msgs
    });
}
