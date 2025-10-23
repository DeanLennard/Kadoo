// apps/worker/src/queue.ts
export type IngestJob = { tenantId: string; threadId: string; uid: number };

type Handler<T> = (payload: T) => Promise<void>;
const subs: Record<string, Handler<any>[]> = {};

// simple in-memory de-dupe: jobId -> expiresAt
const inflight = new Map<string, number>();

type PublishOpts = {
    jobId?: string;
    dedupeTtlMs?: number; // how long to keep a jobId to avoid re-processing
};

function defaultJobId(payload: any) {
    const t = payload?.tenantId ?? "tenant";
    const th = payload?.threadId ?? "thread";
    const u = payload?.uid ?? "uid";
    return `${t}:${th}:${u}`;
}

export async function publish<T>(topic: string, payload: T, opts: PublishOpts = {}) {
    const list = subs[topic] || [];
    if (list.length === 0) return;

    const jobId = opts.jobId ?? defaultJobId(payload);
    const ttl = opts.dedupeTtlMs ?? 5 * 60 * 1000; // 5 min default

    const now = Date.now();
    const exp = inflight.get(jobId);
    if (exp && exp > now) {
        // already in-flight or recently processed; skip
        return;
    }
    // mark as in-flight
    inflight.set(jobId, now + ttl);

    try {
        for (const h of list) {
            await h(payload);
        }
    } finally {
        // keep the jobId until TTL expires (prevents immediate re-queue loops)
        // (we already set expiry above; a cleanup timer can prune old entries)
    }
}

export function subscribe<T>(topic: string, handler: Handler<T>) {
    subs[topic] = subs[topic] || [];
    subs[topic].push(handler as any);
}

// Optional: background cleanup of stale entries
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of inflight.entries()) {
        if (v <= now) inflight.delete(k);
    }
}, 60_000);

// topic name
export const TOPIC_INGEST = "mail.ingest";
