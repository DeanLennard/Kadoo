// apps/worker/src/runners/imapCursor.ts
import { col } from "../db";
export async function getCursor(connectorId) {
    const c = await col("ImapCursor");
    return c.findOne({ _id: connectorId });
}
export async function setCursor(connectorId, tenantId, data) {
    const c = await col("ImapCursor");
    await c.updateOne({ _id: connectorId }, { $set: { tenantId, updatedAt: new Date(), ...data } }, { upsert: true });
}
