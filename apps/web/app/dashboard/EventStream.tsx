// apps/web/app/dashboard/EventStream.tsx
"use client";
import { useEffect, useState } from "react";
import Badge from "@/components/ui/Badge";

type Ev = { kind: string; [k: string]: any };

function MiniJson({ data }: { data: unknown }) {
    return (
        <pre className="text-xs leading-5 bg-[var(--cloud)] rounded-lg p-3 overflow-auto">
      {JSON.stringify(data, null, 2)}
    </pre>
    );
}

export default function EventStream() {
    const [events, setEvents] = useState<Ev[]>([]);

    useEffect(() => {
        const es = new EventSource("/api/realtime/sse");
        es.onmessage = (e) => {
            try {
                const obj = JSON.parse(e.data);
                setEvents((old) => [obj, ...old].slice(0, 30));
            } catch {
                setEvents((old) => [{ kind: "raw", data: e.data }, ...old].slice(0, 30));
            }
        };
        return () => es.close();
    }, []);

    return (
        <div className="space-y-3">
            {events.map((ev, i) => (
                <div key={i} className="border rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-2">
                        <Badge tone={ev.kind === "decision" ? "warm" : "mint"}>{ev.kind}</Badge>
                        <div className="text-xs k-muted">
                            {ev.id ? `#${ev.id}` : ev.logId ? `log:${ev.logId}` : ""}
                        </div>
                    </div>
                    <MiniJson data={ev} />
                </div>
            ))}
        </div>
    );
}
