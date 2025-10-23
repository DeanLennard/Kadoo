// apps/worker/src/pub.ts
import Redis from "ioredis";

const url = process.env.REDIS_URL!;
export const pub = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
});

export async function notifyTenant(tenantId: string, payload: any) {
    await pub.publish(`tenant:${tenantId}`, JSON.stringify(payload));
}

export function emit(tenantId: string, payload: unknown) {
    return pub.publish(`tenant:${tenantId}`, JSON.stringify(payload));
}
