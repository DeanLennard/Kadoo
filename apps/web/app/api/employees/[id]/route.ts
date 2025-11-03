// apps/web/app/api/employees/[id]/route.ts
import { NextResponse } from "next/server";
import { withApiAuth } from "@/lib/api-auth";
import { col } from "@/lib/db";
import { ObjectId } from "mongodb";
import { Queue } from "bullmq";
import { bullConnection as connection } from "@/lib/redis";

const maintenanceQueue = new Queue("maintenance", { connection });

export const PATCH = withApiAuth(async (req, { tenantId, role }) => {
    if (!["owner", "admin"].includes(role)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const url = new URL(req.url);
    const idParam = url.pathname.split("/").pop()!;
    const body = await req.json();

    // Build $set
    const set: any = { updatedAt: new Date() };
    if (typeof body.enabled === "boolean") set.enabled = body.enabled;

    if (body.permissions && typeof body.permissions === "object") {
        set["permissions.canSendEmails"]       = !!body.permissions.canSendEmails;
        set["permissions.canProposeTimes"]     = !!body.permissions.canProposeTimes;
        set["permissions.canAcceptInvites"]    = !!body.permissions.canAcceptInvites;
        set["permissions.canDeclineInvites"]   = !!body.permissions.canDeclineInvites;
        set["permissions.canScheduleMeetings"] = !!body.permissions.canScheduleMeetings;
    }

    if (body.auto && typeof body.auto === "object") {
        if (body.auto.sendWithoutApproval) {
            const swa = body.auto.sendWithoutApproval;
            set["auto.sendWithoutApproval.send_reply"]          = !!swa.send_reply;
            set["auto.sendWithoutApproval.send_calendar_reply"] = !!swa.send_calendar_reply;
            set["auto.sendWithoutApproval.schedule_meeting"]    = !!swa.schedule_meeting;
        }
        if (body.auto.thresholds) {
            const th = body.auto.thresholds;
            if (typeof th.send_reply === "number")          set["auto.thresholds.send_reply"] = th.send_reply;
            if (typeof th.send_calendar_reply === "number") set["auto.thresholds.send_calendar_reply"] = th.send_calendar_reply;
            if (typeof th.schedule_meeting === "number")    set["auto.thresholds.schedule_meeting"] = th.schedule_meeting;
        }
    }

    const Employees = await col<any>("Employee");

    // ✅ define the `or` array
    const or: any[] = [{ _id: idParam }];
    if (ObjectId.isValid(idParam)) {
        or.push({ _id: new ObjectId(idParam) });
    }

    const q = { tenantId, $or: or };

    // Grab previous enabled state to detect flip
    const prev = await Employees.findOne(q);
    const res  = await Employees.updateOne(q, { $set: set });

    if (!res.matchedCount) {
        console.warn("[employees.PATCH] not found for", q);
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const updated = await Employees.findOne(q);

    // Only enqueue rescan if we flipped from disabled -> enabled
    if (prev?.enabled === false && updated?.enabled === true) {
        console.log("[employees.PATCH] EA re-enabled → enqueue rescan", { tenantId, employeeId: idParam });
        await maintenanceQueue.add(
            "rescan-tenant",
            { tenantId },
            { removeOnComplete: true, attempts: 2 }
        );
    }

    return NextResponse.json({ ok: true, item: updated });
}, ["owner", "admin"]);
