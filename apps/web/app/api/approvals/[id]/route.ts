// apps/web/app/api/approvals/[id]/route.ts
import { NextResponse } from "next/server";
import { ObjectId, type Filter } from "mongodb";
import { col } from "@/lib/db";
import type { DecisionLog } from "@/lib/models";
import { withApiAuth } from "@/lib/api-auth";
import { Queue } from "bullmq";
import Redis from "ioredis";

const connection = new Redis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
});
const executeQueue = new Queue("execute", { connection });

// POST /api/approvals/:id  { action: "approve" | "deny" }
export const POST = withApiAuth(async (req, { tenantId, session }) => {
    // get id from URL params
    const url = new URL(req.url);
    const parts = url.pathname.split("/");
    const id = parts[parts.length - 1];

    const { action } = await req.json().catch(() => ({} as any));
    if (!id || (action !== "approve" && action !== "deny")) {
        return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    let _id: ObjectId;
    try {
        _id = new ObjectId(id);
    } catch {
        return NextResponse.json({ error: "Bad id" }, { status: 400 });
    }

    const logs = await col<DecisionLog>("DecisionLog");
    const filter: Filter<DecisionLog> = { _id, tenantId };
    const doc = await logs.findOne(filter);
    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (doc.status !== "pending") {
        return NextResponse.json({ error: "Already handled" }, { status: 409 });
    }

    if (action === "deny") {
        await logs.updateOne(filter, { $set: { status: "denied", deniedAt: new Date() } });
        return NextResponse.json({ ok: true });
    }

    // approve → mark approved + enqueue execution
    await logs.updateOne(filter, { $set: { status: "approved", approvedAt: new Date() } });
    await executeQueue.add(
        doc.action.type || "do",
        { ...doc.action.payload, logId: _id.toString(), tenantId },
        { removeOnComplete: true }
    );

    return NextResponse.json({ ok: true });
}, ["owner", "admin", "reviewer"]);
