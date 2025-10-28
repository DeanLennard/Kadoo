// apps/web/app/api/audit/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { col } from "@/lib/db";

export async function GET(req: Request) {
    const session = await getServerSession();
    if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    const tenantId = (session as any).tenantId;

    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);
    const cursorIso = searchParams.get("before");

    const q: any = { tenantId };
    if (cursorIso) q.ts = { $lt: new Date(cursorIso) };

    const Log = await col<any>("EmployeeActionLog");
    const rows = await Log.find(q).sort({ ts: -1 }).limit(limit).toArray();

    return NextResponse.json({
        items: rows,
        next: rows.length === limit ? rows[rows.length - 1].ts : null
    });
}
