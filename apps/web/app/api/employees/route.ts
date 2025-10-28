// apps/web/app/api/employees/route.ts
import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-auth";
import { col } from "@/lib/db";

export const GET = withApiAuth(async (_req, { tenantId }) => {
    const Employees = await col<any>("Employee");
    const items = await Employees.find({ tenantId }).sort({ name: 1 }).toArray();
    return NextResponse.json({ items });
}, ["owner", "admin", "reviewer", "viewer"]);
