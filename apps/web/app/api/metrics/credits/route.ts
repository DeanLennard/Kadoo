// apps/web/app/api/metrics/credits/route.ts
import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-auth";
import { col } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApiAuth(async (_req, { tenantId }) => {
    const Tenant = await col<any>("Tenant");
    const tenant = await Tenant.findOne(
        { _id: tenantId },
        { projection: { credits: 1 } }
    );
    if (!tenant) return NextResponse.json({ error: "tenant not found" }, { status: 404 });

    // Start of current month (no date-fns)
    const now = new Date();
    const since = new Date(now.getFullYear(), now.getMonth(), 1);

    const Log = await col<any>("EmployeeActionLog");
    const mtd = await Log.aggregate([
        { $match: { tenantId, ts: { $gte: since } } },
        { $group: { _id: null, total: { $sum: "$cost" } } },
    ]).toArray();

    return NextResponse.json({
        balance: tenant.credits?.balance ?? 0,
        planMonthlyAllotment: tenant.credits?.planMonthlyAllotment ?? 0,
        resetDay: tenant.credits?.resetDay ?? 1,
        monthToDateUsed: mtd[0]?.total ?? 0,
    });
});
