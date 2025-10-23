// apps/web/app/dashboard/TestButton.tsx
"use client";
import { useState } from "react";
import Button from "@/components/ui/Button";

export default function TestButton() {
    const [busy, setBusy] = useState(false);
    const [ok, setOk] = useState<boolean | null>(null);

    return (
        <Button
            onClick={async () => {
                setBusy(true);
                setOk(null);
                try {
                    const res = await fetch("/api/test/enqueue", { method: "POST" });
                    setOk(res.ok);
                    if (!res.ok) throw new Error("enqueue failed");
                } catch (e) {
                    console.error(e);
                    alert("Failed to enqueue test job");
                } finally {
                    setBusy(false);
                }
            }}
            aria-busy={busy}
        >
            {busy ? "Queuing…" : ok ? "Queued ✓" : "Queue Test Event"}
        </Button>
    );
}
