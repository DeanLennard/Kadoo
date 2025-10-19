// apps/web/app/dashboard/page.tsx
"use client";
import { useEffect, useState } from "react";

export default function Dashboard() {
    const [events, setEvents] = useState<string[]>([]);
    useEffect(() => {
        const es = new EventSource("/api/realtime/sse");
        es.onmessage = (e) => setEvents((old) => [e.data, ...old].slice(0, 20));
        return () => es.close();
    }, []);
    return (
        <main style={{ padding: 24 }}>
            <h1>Kadoo Dashboard</h1>
            <ul>{events.map((e, i) => <li key={i}><pre>{e}</pre></li>)}</ul>
        </main>
    );
}
