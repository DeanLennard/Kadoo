// apps/worker/src/redis.ts
import Redis from "ioredis";
const url = process.env.REDIS_URL || "redis://localhost:6379/0";
const isTls = url.startsWith("rediss://");
// Required by BullMQ when using ioredis v5+
export const connection = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 10000,
    keepAlive: 1,
    ...(isTls ? { tls: {} } : {})
});
