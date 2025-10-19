// apps/web/lib/queues.ts
import { Queue } from "bullmq";
import { redis } from "./redis";

export const eventsQueue = new Queue("events", { connection: redis.options as any });
export const decisionsQueue = new Queue("decisions", { connection: redis.options as any });
export const executeQueue = new Queue("execute", { connection: redis.options as any });
