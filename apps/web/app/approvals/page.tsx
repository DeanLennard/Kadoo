// apps/web/app/approvals/page.tsx
"use client";
import { useEffect, useState } from "react";

type ApprovalItem = {
    _id: string;
    createdAt: string;
    confidence: number;
    action: { type: string; payload: any };
};

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
            <h1>Approvals</h1>
            <button onClick={load} disabled={loading} style={{ margin: "12px 0" }}>
                {loading ? "Refreshing…" : "Refresh"}
            </button>
            {items.length === 0 && <p>No approvals pending.</p>}
            <ul style={{ display: "grid", gap: 12 }}>
                {items.map((it) => (
                    <li key={it._id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
                        <div style={{ fontSize: 12, opacity: 0.7 }}>
                            {new Date(it.createdAt).toLocaleString()} • conf {(it.confidence * 100).toFixed(0)}%
                        </div>
                        <h3 style={{ margin: "6px 0" }}>{it.action.type}</h3>
                        <pre style={{ background: "#f7f7f7", padding: 12, borderRadius: 6, overflowX: "auto" }}>
              {JSON.stringify(it.action.payload, null, 2)}
            </pre>
                        <div style={{ display: "flex", gap: 8 }}>
                            <button onClick={() => act(it._id, "approve")}>Approve</button>
                            <button onClick={() => act(it._id, "deny")}>Deny</button>
                        </div>
                    </li>
                ))}
            </ul>
        </main>
    );
}
