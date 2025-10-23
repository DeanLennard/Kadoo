// apps/worker/src/queue.ts
export type IngestJob = { tenantId: string; threadId: string; uid: number };

type Handler<T> = (payload: T) => Promise<void>;
const subs: Record<string, Handler<any>[]> = {};

export async function publish<T>(topic: string, payload: T) {
    const list = subs[topic] || [];
    for (const h of list) await h(payload);
}

export function subscribe<T>(topic: string, handler: Handler<T>) {
    subs[topic] = subs[topic] || [];
    subs[topic].push(handler as any);
}

// topic name
export const TOPIC_INGEST = "mail.ingest";
