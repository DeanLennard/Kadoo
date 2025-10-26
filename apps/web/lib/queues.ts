// apps/web/lib/queues.ts
import { Queue } from "bullmq";
import { bullConnection } from "./redis";

export const eventsQueue = new Queue("events", { connection: bullConnection });
export const decisionsQueue = new Queue("decisions", { connection: bullConnection });
export const executeQueue = new Queue("execute", { connection: bullConnection });
