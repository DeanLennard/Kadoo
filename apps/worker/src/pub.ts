// apps/worker/src/pub.ts
import Redis from "ioredis";
const pub = new Redis(process.env.REDIS_URL!);
export async function notifyTenant(tenantId: string, payload: any) {
    await pub.publish(`tenant:${tenantId}`, JSON.stringify(payload));
}
