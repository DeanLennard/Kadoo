// apps/worker/src/workers/rescan.ts
import { Worker } from "bullmq";
import { connection } from "../redis";
import { col } from "../db";
import { publish, TOPIC_INGEST } from "../queue"; // ✅ import the constant

export const rescanWorker = new Worker(
    "maintenance",
    async (job) => {
        if (job.name !== "rescan-tenant") return;
        const { tenantId } = job.data as { tenantId: string };
        const messages = await col("MailMessage");

        // (optional but very helpful)
        console.log("[maintenance] rescan-tenant.start", { tenantId });

        const cursor = messages.find(
            {
                tenantId,
                ingestDeferred: true,
                $or: [
                    { processingLock: { $exists: false } },
                    { "processingLock.expiresAt": { $lt: new Date() } },
                ],
            },
            { projection: { threadId: 1, uid: 1, _id: 0 } }
        );

        let count = 0;
        for await (const m of cursor) {
            await messages.updateOne(
                { tenantId, threadId: m.threadId, uid: m.uid },
                { $unset: { ingestDeferred: "", ingestDeferredAt: "" } }
            );

            // ✅ publish to the SAME topic your worker subscribes to
            // ✅ give it a unique jobId to bypass in-flight dedupe
            await publish(
                TOPIC_INGEST,
                { tenantId, threadId: m.threadId, uid: m.uid },
                { jobId: `${tenantId}:${m.threadId}:${m.uid}:rescan` }
            );

            count++;
        }

        console.log("[maintenance] rescan-tenant.done", { tenantId, count });
    },
    { connection }
);
