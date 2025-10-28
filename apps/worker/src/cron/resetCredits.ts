// apps/worker/src/cron/resetCredits.ts
import { col } from "../db";

export async function resetCreditsDaily() {
    const tenants = await col<any>("Tenant");
    const today = new Date();
    const day = today.getUTCDate();

    const cursor = tenants.find({
        "credits.resetDay": day
    });

    for await (const t of cursor) {
        await tenants.updateOne(
            { _id: t._id },
            {
                $set: {
                    "credits.balance": t.credits.planMonthlyAllotment,
                    "credits.lastResetAt": new Date()
                }
            }
        );
    }
}
