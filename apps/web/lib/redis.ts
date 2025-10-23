// apps/web/lib/redis.ts (for BullMQ clients in web)
import Redis from "ioredis";

const url = process.env.REDIS_URL || "redis://localhost:6379/0";

// BullMQ-friendly defaults; also fine for general use
export const bullConnection = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 10_000,
    keepAlive: 1,
});

