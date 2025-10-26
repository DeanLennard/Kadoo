// apps/web/lib/redis.ts
import Redis from "ioredis";

const url = process.env.REDIS_URL || "redis://localhost:6379/0";

// Single shared client
export const redis = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    connectTimeout: 10_000,
    keepAlive: 1,
});

// Back-compat alias for BullMQ code that expects this name
export const bullConnection = redis;
