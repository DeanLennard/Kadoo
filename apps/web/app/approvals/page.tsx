"use client";
import { useEffect, useMemo, useState, useCallback } from "react";

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

    const load = useCallback(async () => {
        setLoading(true);
        const res = await fetch(
            `/api/approvals${since ? `?since=${encodeURIComponent(since)}` : ""}`,
            { cache: "no-store" }
        );
        const data = await res.json();
        setItems(data.items ?? []);
        setLoading(false);
    }, [since]);

    useEffect(() => {
        load();
        const id = setInterval(load, 15000);
        return () => clearInterval(id);
    }, [load]);

    async function act(id: string, action: "approve" | "deny") {
        // optimistic remove
        setItems((prev) => prev.filter((x) => x._id !== id));
        await fetch(`/api/approvals/${id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action }),
        });
        // optional: await load();
    }

    // keyboard shortcuts: A = approve, D = deny (first item)
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (items.length === 0) return;
            if (e.key.toLowerCase() === "a") act(items[0]._id, "approve");
            if (e.key.toLowerCase() === "d") act(items[0]._id, "deny");
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [items]);

    return (
        <main className="p-6 max-w-5xl mx-auto space-y-6">
            <div className="flex items-center justify-between gap-3">
                <h1 className="k-h1">Approvals</h1>
                <button onClick={load} disabled={loading} className="k-btn">
                    {loading ? "Refreshing…" : "Refresh"}
                </button>
            </div>

            {items.length === 0 && <p className="k-muted">No approvals pending.</p>}

            <ul className="grid gap-4">
                {items.map((it) => (
                    <li key={it._id} className="border rounded-lg p-4 bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
                        <div className="flex items-baseline justify-between">
                            <div className="text-xs text-neutral-500 dark:text-neutral-400">
                                {new Date(it.createdAt).toLocaleString("en-GB")} • conf{" "}
                                {(it.confidence * 100).toFixed(0)}%
                            </div>
                            <StatusBadge type={it.action.type} />
                        </div>

                        <h3 className="k-title mt-1 mb-3">{labelForAction(it.action.type)}</h3>

                        {it.action.type === "schedule_meeting" ? (
                            <MeetingApproval payload={it.action.payload} />
                        ) : it.action.type === "create_draft_reply" ||
                        it.action.type === "send_reply" ? (
                            <DraftApproval payload={it.action.payload} />
                        ) : (
                            <RawJson payload={it.action.payload} />
                        )}

                        <div className="flex flex-wrap gap-2 mt-4">
                            <button
                                className="k-btn k-btn-primary"
                                onClick={() => act(it._id, "approve")}
                                title="A"
                            >
                                Approve
                            </button>
                            <button className="k-btn" onClick={() => act(it._id, "deny")} title="D">
                                Deny
                            </button>
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
    if (t === "send_reply") return "Send reply";
    if (t === "send_calendar_reply") return "Calendar response";
    return t;
}

function StatusBadge({ type }: { type: string }) {
    const map: Record<string, string> = {
        schedule_meeting: "purple",
        create_draft_reply: "blue",
        send_reply: "green",
        send_calendar_reply: "amber",
    };
    const colour = map[type] ?? "neutral";
    const cls =
        colour === "blue"
            ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200"
            : colour === "green"
                ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-200"
                : colour === "purple"
                    ? "bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-200"
                    : colour === "amber"
                        ? "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200"
                        : "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200";
    return (
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {type}
    </span>
    );
}

/* ---------- Draft (send reply) renderer ---------- */

function DraftApproval({
                           payload,
                       }: {
    payload: {
        to?: string[];
        subject?: string;
        body_md?: string;
        body_html?: string;
        // calendar extras may be present but are ignored here
    };
}) {
    const to = (payload?.to ?? []).filter(Boolean);
    const subject = payload?.subject || "(no subject)";

    // prefer supplied HTML; otherwise render a safe HTML from body_md
    const html = payload?.body_html || mdToHtmlLite(payload?.body_md || "");

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-neutral-500 dark:text-neutral-400">To:</span>
                {to.length > 0 ? (
                    to.map((addr) => (
                        <span
                            className="px-2 py-0.5 rounded-full text-xs bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
                            key={addr}
                            title={addr}
                        >
              {addr}
            </span>
                    ))
                ) : (
                    <span className="k-muted text-sm">—</span>
                )}
            </div>

            <div className="text-sm">
                <span className="text-neutral-500 dark:text-neutral-400">Subject:</span>{" "}
                <span className="font-medium">{subject}</span>
            </div>

            <div className="border rounded-md">
                <div className="px-3 py-2 text-xs text-neutral-500 dark:text-neutral-400 border-b">Preview</div>
                <div
                    className="p-3 text-sm leading-6 prose prose-sm dark:prose-invert max-w-none text-neutral-900 dark:text-neutral-100"
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{ __html: html }}
                />
            </div>

            <details className="rounded-md">
                <summary className="cursor-pointer text-sm text-neutral-500 dark:text-neutral-400">Raw JSON</summary>
                <pre className="bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-200 p-3 rounded overflow-x-auto text-xs mt-2">
{JSON.stringify(payload, null, 2)}
        </pre>
            </details>
        </div>
    );
}

/* ---------- Meeting renderer (kept, with dark text fixes) ---------- */

function MeetingApproval({
                             payload,
                         }: {
    payload: {
        attendeeEmail: string;
        durationMin: number;
        windowISO: string[];
        conference?: "meet" | "teams" | "zoom" | "jitsi";
    };
}) {
    const [busy, setBusy] = useState<BusyEvent[]>([]);
    useEffect(() => {
        fetch("/api/calendar/events?days=14", { cache: "no-store" })
            .then((r) => r.json())
            .then((data) => setBusy(data.events ?? []))
            .catch(() => setBusy([]));
    }, []);

    const firstSlot = useMemo(() => {
        const stepMs = 15 * 60_000;
        const durMs = payload.durationMin * 60_000;
        const now = Date.now() + 12 * 60 * 60 * 1000; // mirror minNotice=12h
        const busyRanges = busy
            .map((b) => [new Date(b.start).getTime(), new Date(b.end).getTime()] as const)
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
                <div>
                    <b>Attendee:</b> {payload.attendeeEmail}
                </div>
                <div>
                    <b>Duration:</b> {payload.durationMin} min
                </div>
                {payload.conference && (
                    <div>
                        <b>Conference:</b> {payload.conference}
                    </div>
                )}
            </div>

            <div className="text-sm">
                <b>Proposed window(s):</b>
                <ul className="list-disc pl-5 mt-1">
                    {payload.windowISO.map((w, i) => {
                        const [sIso, eIso] = w.split("/");
                        return <li key={i}>{formatRange(sIso, eIso)}</li>;
                    })}
                </ul>
            </div>

            <div className="text-sm">
                <b>First available slot:</b>{" "}
                {firstSlot ? (
                    `${formatDT(firstSlot.start)} to ${formatDT(firstSlot.end)}`
                ) : (
                    <span className="k-muted">No free slot in the proposed window(s)</span>
                )}
            </div>

            <BusyList busy={busy} />
        </div>
    );
}

function BusyList({ busy }: { busy: BusyEvent[] }) {
    if (busy.length === 0) return null;
    const next = busy
        .slice()
        .sort((a, b) => +new Date(a.start) - +new Date(b.start))
        .slice(0, 6);

    return (
        <div className="mt-2">
            <div className="k-muted text-xs mb-1">Upcoming busy</div>
            <div className="grid sm:grid-cols-2 gap-2">
                {next.map((b, i) => (
                    <div
                        key={i}
                        className="text-xs bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 rounded px-2 py-1"
                    >
                        {formatDT(b.start)}–{timeHM(b.end)} {b.summary ? `· ${b.summary}` : ""}
                    </div>
                ))}
            </div>
        </div>
    );
}

/* ---------- Small helpers ---------- */

function formatDT(s: string | Date) {
    const d = typeof s === "string" ? new Date(s) : s;
    return d.toLocaleString("en-GB", {
        weekday: "short",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    });
}
function timeHM(s: string) {
    const d = new Date(s);
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
function formatRange(sIso?: string, eIso?: string) {
    if (!sIso || !eIso) return "Invalid range";
    return `${formatDT(sIso)} → ${formatDT(eIso)}`;
}

/** Very small/safe-ish markdown → HTML for previews (no external libs).
 *  - Escapes HTML
 *  - Paragraph/line breaks
 *  - Bullet points
 */
function mdToHtmlLite(md: string) {
    const esc = (s: string) =>
        s
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    const lines = esc(md).split(/\r?\n/);

    // bullets: transform lines starting with -, *, • into <li>
    const out: string[] = [];
    let inList = false;
    for (const ln of lines) {
        if (/^\s*([-*•])\s+/.test(ln)) {
            if (!inList) {
                inList = true;
                out.push("<ul>");
            }
            out.push(`<li>${ln.replace(/^\s*([-*•])\s+/, "")}</li>`);
        } else {
            if (inList) {
                inList = false;
                out.push("</ul>");
            }
            out.push(ln === "" ? "<br/>" : `<p>${ln}</p>`);
        }
    }
    if (inList) out.push("</ul>");
    return out.join("\n");
}

function RawJson({ payload }: { payload: any }) {
    return (
        <pre className="bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 p-3 rounded overflow-x-auto text-xs">
{JSON.stringify(payload, null, 2)}
    </pre>
    );
}
