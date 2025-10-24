// apps/worker/policy/availability.ts
import { col } from '../db';
export async function pickSlot(args: {
    tenantId: string;
    windowISO: string[];
    durationMin: number;
    buffers: { before: number; after: number };
    minNoticeMin: number;
}) {
    const now = Date.now() + args.minNoticeMin * 60_000;
    for (const w of args.windowISO) {
        const [startIso, endIso] = w.split('/');
        const start = new Date(startIso), end = new Date(endIso);
        const events = await (await col<any>('cal_events')).find({
            tenantId: args.tenantId,
            start: { $lt: end }, end: { $gt: start }
        }).project({ start:1, end:1 }).toArray();

        const busy = events.map(e => [new Date(e.start).getTime(), new Date(e.end).getTime()])
            .sort((a,b)=>a[0]-b[0]);

        const step = 15 * 60_000; // 15m granularity
        for (let t = Math.max(start.getTime(), now); t + args.durationMin*60_000 <= end.getTime(); t += step) {
            const s = t - args.buffers.before*60_000;
            const e = t + (args.durationMin + args.buffers.after)*60_000;
            const overlaps = busy.some(([bs, be]) => s < be && e > bs);
            if (!overlaps) return { start: new Date(t), end: new Date(t + args.durationMin*60_000) };
        }
    }
    return null;
}
