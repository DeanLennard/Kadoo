// apps/web/app/approvals/page.tsx
"use client";
import { useEffect, useMemo, useState } from "react";

type ApprovalItem = {
    _id: string;
    createdAt: string;
    confidence: number;
    action: { type: string; payload: any };
};

type BusyEvent = { start: string; end: string; summary?: string };

export default function ApprovalsPage() {
    const [items, setItems] = useState<ApprovalItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [since] = useState<string | undefined>(undefined);

    async function load() {
        setLoading(true);
        const res = await fetch(`/api/approvals${since ? `?since=${encodeURIComponent(since)}` : ""}`, { cache: "no-store" });
        const data = await res.json();
        setItems(data.items ?? []);
        setLoading(false);
    }
    useEffect(() => {
        load();
        const id = setInterval(load, 15000);
        return () => clearInterval(id);
    }, []);

    async function act(id: string, action: "approve" | "deny") {
        await fetch(`/api/approvals/${id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action })
        });
        await load();
    }

    return (
        <main className="p-6 max-w-5xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="k-h1">Approvals</h1>
                <button onClick={load} disabled={loading} className="k-btn">
                    {loading ? "Refreshing…" : "Refresh"}
                </button>
            </div>

            {items.length === 0 && <p className="k-muted">No approvals pending.</p>}

            <ul className="grid gap-4">
                {items.map((it) => (
                    <li key={it._id} className="border rounded-lg p-4">
                        <div className="text-xs k-muted">
                            {new Date(it.createdAt).toLocaleString("en-GB")} • conf {(it.confidence * 100).toFixed(0)}%
                        </div>
                        <h3 className="k-title mt-1 mb-3">{labelForAction(it.action.type)}</h3>

                        {it.action.type === "schedule_meeting" ? (
                            <MeetingApproval payload={it.action.payload} />
                        ) : (
                            <pre className="bg-neutral-50 dark:bg-neutral-900 p-3 rounded overflow-x-auto text-xs">
                {JSON.stringify(it.action.payload, null, 2)}
              </pre>
                        )}

                        <div className="flex gap-2 mt-3">
                            <button className="k-btn k-btn-primary" onClick={() => act(it._id, "approve")}>Approve</button>
                            <button className="k-btn" onClick={() => act(it._id, "deny")}>Deny</button>
                        </div>
                    </li>
                ))}
            </ul>
        </main>
    );
}

function labelForAction(t: string) {
    if (t === "schedule_meeting") return "Schedule meeting";
    if (t === "create_draft_reply") return "Send draft reply";
    return t;
}

function MeetingApproval({ payload }: {
    payload: { attendeeEmail: string; durationMin: number; windowISO: string[]; conference?: "meet"|"teams"|"zoom"|"jitsi" }
}) {
    const [busy, setBusy] = useState<BusyEvent[]>([]);
    useEffect(() => {
        // load next 14 days of busy events
        fetch("/api/calendar/events?days=14", { cache: "no-store" })
            .then(r => r.json())
            .then(data => setBusy(data.events ?? []))
            .catch(() => setBusy([]));
    }, []);

    const firstSlot = useMemo(() => {
        // naive slot picker (15-min steps) for preview ONLY — server still decides definitively
        const stepMs = 15 * 60_000;
        const durMs = payload.durationMin * 60_000;
        const now = Date.now() + 12 * 60 * 60 * 1000; // mirror minNotice=12h used server-side
        const busyRanges = busy
            .map(b => [new Date(b.start).getTime(), new Date(b.end).getTime()] as const)
            .sort((a, b) => a[0] - b[0]);

        for (const w of payload.windowISO ?? []) {
            const [sIso, eIso] = (w || "").split("/");
            if (!sIso || !eIso) continue;
            const wStart = Math.max(new Date(sIso).getTime(), now);
            const wEnd = new Date(eIso).getTime();

            for (let t = wStart; t + durMs <= wEnd; t += stepMs) {
                const start = t;
                const end = t + durMs;
                const overlaps = busyRanges.some(([bs, be]) => start < be && end > bs);
                if (!overlaps) return { start: new Date(start), end: new Date(end) };
            }
        }
        return null;
    }, [busy, payload]);

    return (
        <div className="space-y-3">
            <div className="text-sm">
                <div><b>Attendee:</b> {payload.attendeeEmail}</div>
                <div><b>Duration:</b> {payload.durationMin} min</div>
                {payload.conference && <div><b>Conference:</b> {payload.conference}</div>}
            </div>

            <div className="text-sm">
                <b>Proposed window(s):</b>
                <ul className="list-disc pl-5 mt-1">
                    {payload.windowISO.map((w, i) => {
                        const [sIso, eIso] = w.split("/");
                        return (
                            <li key={i}>
                                {formatRange(sIso, eIso)}
                            </li>
                        );
                    })}
                </ul>
            </div>

            <div className="text-sm">
                <b>First available slot:</b>{" "}
                {firstSlot
                    ? `${formatDT(firstSlot.start)} to ${formatDT(firstSlot.end)}`
                    : <span className="k-muted">No free slot in the proposed window(s)</span>}
            </div>

            <BusyList busy={busy} />
        </div>
    );
}

function BusyList({ busy }: { busy: BusyEvent[] }) {
    if (busy.length === 0) return null;
    // show the next few busy items to give context
    const next = busy
        .slice()
        .sort((a, b) => +new Date(a.start) - +new Date(b.start))
        .slice(0, 6);

    return (
        <div className="mt-2">
            <div className="k-muted text-xs mb-1">Upcoming busy</div>
            <div className="grid sm:grid-cols-2 gap-2">
                {next.map((b, i) => (
                    <div key={i} className="text-xs bg-neutral-50 dark:bg-neutral-900 rounded px-2 py-1">
                        {formatDT(b.start)}–{timeHM(b.end)} {b.summary ? `· ${b.summary}` : ""}
                    </div>
                ))}
            </div>
        </div>
    );
}

function formatDT(s: string | Date) {
    const d = typeof s === "string" ? new Date(s) : s;
    return d.toLocaleString("en-GB", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function timeHM(s: string) {
    const d = new Date(s);
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
function formatRange(sIso?: string, eIso?: string) {
    if (!sIso || !eIso) return "Invalid range";
    return `${formatDT(sIso)} → ${formatDT(eIso)}`;
}
