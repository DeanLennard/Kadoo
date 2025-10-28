// apps/web/app/dashboard/page.tsx
"use client";
import useSWR from "swr";
import { useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import TestButton from "./TestButton";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import EventStream from "./EventStream";

const fetcher = (u: string) => fetch(u).then(r => r.json());

export default function Dashboard() {
    const { data: session, status } = useSession();
    const tenantId = (session as any)?.tenantId;
    const role = (session as any)?.role;

    const { data, mutate } = useSWR(status === "authenticated" ? "/api/metrics/credits" : null, fetcher);

    // (Optional) listen for SSE credit updates
    useEffect(() => {
        const es = new EventSource("/api/realtime/sse");
        es.onmessage = e => {
            try {
                const obj = JSON.parse(e.data);
                if (obj.kind === "credits_update") mutate();
            } catch {}
        };
        return () => es.close();
    }, [mutate]);

    if (status === "loading") return <main className="p-6 max-w-5xl mx-auto space-y-6">Loading session…</main>;
    if (status === "unauthenticated") return (
        <main className="p-6 max-w-5xl mx-auto space-y-6">
            <Card>
                <div className="k-h2 mb-2">You’re not signed in</div>
                <p className="k-muted">Please <a className="underline" href="/login">log in</a> to continue.</p>
            </Card>
        </main>
    );

    const balance = data?.balance ?? 0;
    const allotment = data?.planMonthlyAllotment ?? 0;
    const mtdUsed = data?.monthToDateUsed ?? 0;

    return (
        <main className="p-6 max-w-5xl mx-auto space-y-6">
            {/* Top bar */}
            <div className="flex items-center gap-4">
                <div className="flex-1">
                    <div className="k-h1">Kadoo Dashboard</div>
                    <div className="text-sm k-muted">
                        Welcome <span className="font-medium">{session?.user?.email}</span> • Tenant{" "}
                        <code className="bg-[var(--cloud)] px-1.5 py-0.5 rounded">{tenantId}</code>{" "}
                        • <Badge>{role}</Badge>
                    </div>
                </div>
                <TestButton />
                <button className="k-btn k-btn-ghost" onClick={() => signOut({ callbackUrl: "/login" })}>
                    Sign out
                </button>
            </div>

            {/* At-a-glance cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                    <div className="k-muted text-xs mb-1">Credits</div>
                    <div className="k-title">{balance.toLocaleString("en-GB")}</div>
                    <div className="text-xs k-muted">
                        {mtdUsed.toLocaleString("en-GB")} used of {allotment.toLocaleString("en-GB")} this month
                    </div>
                </Card>

                <Card>
                    <div className="k-muted text-xs mb-1">Approvals</div>
                    <div className="k-title">Pending actions</div>
                    <div className="text-xs k-muted">Open the queue to review</div>
                </Card>

                <Card>
                    <div className="k-muted text-xs mb-1">Realtime</div>
                    <div className="k-title">Live events</div>
                    <div className="text-xs k-muted">Queue → Decision → Execute</div>
                </Card>
            </div>

            {/* Live stream */}
            <Card className="p-4">
                <div className="flex items-center justify-between mb-3">
                    <div className="k-h2">Event Stream</div>
                    <span className="k-badge k-badge-mint">connected</span>
                </div>
                <EventStream />
            </Card>

            {/* Audit log */}
            <AuditLog />
        </main>
    );
}

function AuditLog() {
    const { data, size, setSize, isValidating } = useAudit();
    const rows = data?.flatMap((d:any)=>d.items) ?? [];
    const nextCursor = data?.[data.length-1]?.next;

    return (
        <Card className="p-4">
            <div className="k-h2 mb-3">Audit Log</div>
            <div className="overflow-auto">
                <table className="min-w-full text-sm">
                    <thead className="text-left k-muted">
                    <tr><th className="py-2 pr-4">Time</th><th className="py-2 pr-4">Action</th><th className="py-2 pr-4">Cost</th><th className="py-2 pr-4">Thread</th></tr>
                    </thead>
                    <tbody>
                    {rows.map((r:any)=>(
                        <tr key={r._id}>
                            <td className="py-1 pr-4">{new Date(r.ts).toLocaleString("en-GB")}</td>
                            <td className="py-1 pr-4">{r.action}</td>
                            <td className="py-1 pr-4">-{r.cost}</td>
                            <td className="py-1 pr-4"><code className="text-xs">{r.threadId ?? "-"}</code></td>
                        </tr>
                    ))}
                    </tbody>
                </table>
            </div>
            {nextCursor && (
                <button
                    className="k-btn k-btn-ghost mt-3"
                    onClick={()=>setSize(size+1)}
                    disabled={isValidating}
                >
                    {isValidating ? "Loading…" : "Load more"}
                </button>
            )}
        </Card>
    );
}

function useAudit() {
    // basic infinite loader
    const [pages, setPages] = useState<string[]>([""]);
    const { data, error, isValidating, size, setSize } = (require("swr/infinite") as any).default(
        (index: number, prev: any) => {
            const before = index === 0 ? "" : (prev?.next ? `?before=${encodeURIComponent(prev.next)}` : null);
            if (before === null) return null;
            return `/api/audit${before}`;
        },
        (u: string) => fetch(u).then(r => r.json())
    );
    return { data, error, isValidating, size, setSize };
}
