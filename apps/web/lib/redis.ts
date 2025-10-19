// apps/web/lib/redis.ts (for BullMQ clients in web)
import Redis from "ioredis";
const url = process.env.REDIS_URL || "redis://localhost:6379/0";
const isTls = url.startsWith("rediss://");

export const bullConnection = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    ...(isTls ? { tls: {} } : {})
});
