// apps/worker/src/util/credits.ts
import { ObjectId } from "mongodb";
import { col } from "../db";

export async function spendCreditsAndLog(opts: {
    tenantId: string;
    cost: number;
    action: string;
    employeeId?: string;
    threadId?: string;
    meta?: Record<string, any>;
}) {
    const { tenantId, cost, action, employeeId, threadId, meta } = opts;
    if (cost < 0) throw new Error("cost must be >= 0");

    const tenants = await col<any>("Tenant");
    const res = await tenants.findOneAndUpdate(
        { _id: tenantId },
        { $inc: { "credits.balance": -cost } },
        { returnDocument: "after" }
    );
    if (!res.value) throw new Error("Tenant not found");

    const logs = await col<any>("EmployeeActionLog");
    await logs.insertOne({
        tenantId,
        ts: new Date(),
        employeeId,
        action,
        threadId,
        cost,
        meta
    });

    return res.value.credits.balance as number;
}
