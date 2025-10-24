// apps/web/app/(app)/calendar/page.tsx
"use client";
import useSWR from "swr";

type Event = { start: string; end: string; summary?: string };

const fetcher = (u: string) => fetch(u).then(r => r.json());

export default function CalendarPage() {
    const { data } = useSWR<{ events: Event[] }>("/api/calendar/events?days=14", fetcher);
    const events = data?.events ?? [];

    return (
        <main className="p-6 max-w-5xl mx-auto space-y-6">
            <h1 className="k-h1">Calendar</h1>
            <div className="k-muted">Next 14 days (busy blocks)</div>
            <div className="grid grid-cols-7 gap-2">
                {Array.from({ length: 14 }).map((_, i) => (
                    <Day key={i} offsetDays={i} events={events}/>
                ))}
            </div>
        </main>
    );
}

function Day({ offsetDays, events }: { offsetDays: number; events: Event[] }) {
    const dayStart = new Date(); dayStart.setHours(0,0,0,0);
    dayStart.setDate(dayStart.getDate() + offsetDays);
    const dayEnd = new Date(dayStart.getTime() + 24*3600*1000);

    const busy = events.filter(e => {
        const s = new Date(e.start).getTime();
        const eEnd = new Date(e.end).getTime();
        return s < dayEnd.getTime() && eEnd > dayStart.getTime();
    });

    return (
        <div className="border rounded p-2 min-h-48">
            <div className="k-title mb-2">
                {dayStart.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
            </div>
            <div className="space-y-2">
                {busy.length === 0 && <div className="text-xs k-muted">Free</div>}
                {busy.map((b, i) => (
                    <div key={i} className="text-xs bg-neutral-100 dark:bg-neutral-800 rounded px-2 py-1">
                        {timeHM(b.start)}–{timeHM(b.end)} {b.summary ? `· ${b.summary}` : ""}
                    </div>
                ))}
            </div>
        </div>
    );
}

function timeHM(s: string) {
    const d = new Date(s);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
