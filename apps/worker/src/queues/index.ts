// apps/worker/src/queues/index.ts
import { Worker, Queue, QueueEvents, JobsOptions } from "bullmq";
import { connection } from "../redis";

export const eventsQueue = new Queue("events", { connection });
export const decisionsQueue = new Queue("decisions", { connection });
export const executeQueue = new Queue("execute", { connection });

new QueueEvents("events", { connection });
new QueueEvents("decisions", { connection });
new QueueEvents("execute", { connection });

const defaultOpts: JobsOptions = { removeOnComplete: true, removeOnFail: 50 };

export const eventsWorker = new Worker(
    "events",
    async (job) => {
        console.log("[events] job:", job.name, job.id, job.data);
        // echo to decisions as a demo
        await decisionsQueue.add("plan", { fromEvent: job.data }, defaultOpts);
    },
    { connection }
);

export const decisionsWorker = new Worker(
    "decisions",
    async (job) => {
        console.log("[decisions] job:", job.name, job.id, job.data);
        // echo to execute as a demo
        await executeQueue.add("do", { plan: job.data }, defaultOpts);
    },
    { connection }
);

export const executeWorker = new Worker(
    "execute",
    async (job) => {
        console.log("[execute] job:", job.name, job.id, job.data);
        // TODO: call provider adapters here (gmail label/draft, etc.)
    },
    { connection }
);
