// apps/web/app/api/approvals/route.ts
import { NextRequest, NextResponse } from "next/server";
import { col } from "@/lib/db";
import type { DecisionLog } from "@/lib/models";
import { withApiAuth } from "@/lib/api-auth"; // from the helper I shared

// View approvals: allow everyone signed-in to read (owner/admin/reviewer/viewer)
export const GET = withApiAuth(async (req, { tenantId }) => {
    const url = new URL(req.url);
    const since = url.searchParams.get("since"); // optional ISO timestamp

    const query: any = { tenantId, status: "pending" };
    if (since) {
        const d = new Date(since);
        if (!Number.isNaN(d.valueOf())) query.createdAt = { $gte: d };
    }

    const logs = await col<DecisionLog>("DecisionLog");
    const items = await logs
        .find(query)
        .sort({ createdAt: -1 })
        .limit(50)
        .toArray();

    return NextResponse.json({ items });
}, ["owner", "admin", "reviewer", "viewer"]);
