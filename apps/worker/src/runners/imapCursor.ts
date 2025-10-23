// apps/worker/src/runners/imapCursor.ts
import { col } from "../db";

export type ImapCursor = {
    _id: string;                // connectorId
    tenantId: string;
    uidValidity?: number;       // from server
    lastUid?: number;           // highest UID we’ve stored
    updatedAt: Date;
};

export async function getCursor(connectorId: string) {
    const c = await col<ImapCursor>("ImapCursor");
    return c.findOne({ _id: connectorId });
}

export async function setCursor(connectorId: string, tenantId: string, data: Partial<ImapCursor>) {
    const c = await col<ImapCursor>("ImapCursor");
    await c.updateOne(
        { _id: connectorId },
        { $set: { tenantId, updatedAt: new Date(), ...data } },
        { upsert: true }
    );
}
