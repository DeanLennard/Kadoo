// apps/web/app/employees/page.tsx
"use client";
import useSWR from "swr";
import { useState } from "react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Toggle from "@/components/ui/Toggle";

const fetcher = (u: string) => fetch(u).then(r => r.json());

export default function EmployeesPage() {
    const { data, mutate, isLoading } = useSWR("/api/employees", fetcher);
    const items = data?.items ?? [];

    return (
        <main className="p-6 max-w-5xl mx-auto space-y-4">
            <div className="k-h1">Employees</div>
            {isLoading && <div>Loading…</div>}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {items.map((e: any) => (
                    <EmployeeCard key={e._id} emp={e} onChange={() => mutate()} />
                ))}
            </div>
        </main>
    );
}

function Row({ label, children }: any) {
    return (
        <div className="flex items-center justify-between py-1">
            <div className="text-sm">{label}</div>
            <div className="flex items-center gap-2">{children}</div>
        </div>
    );
}

type NumberInputProps = {
    value: number;
    onChange: (v: number) => void;
    min?: number;
    max?: number;
    step?: number;
    ariaLabel?: string;
};

function NumberInput({
                         value,
                         onChange,
                         min = 0,
                         max = 1,
                         step = 0.01,
                         ariaLabel = "number input",
                     }: NumberInputProps) {
    const [local, setLocal] = useState(String(value ?? ""));
    return (
        <input
            aria-label={ariaLabel}
            type="number"
            inputMode="decimal"
            step={step}
            min={min}
            max={max}
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            onBlur={() => {
                const v = Number(local);
                if (!Number.isNaN(v)) onChange(v);
                else setLocal(String(value ?? "")); // snap back on bad input
            }}
            className="
        w-24 px-2 py-1
        border border-[var(--cloud-600,#e5e7eb)]
        rounded-md bg-white
        text-[var(--ink,#111827)] text-right
        shadow-sm
        focus:outline-none focus:ring-2 focus:ring-[var(--mint-500,#10b981)] focus:border-transparent
        disabled:opacity-60
        dark:bg-[var(--panel,#111827)] dark:text-[var(--snow,#f9fafb)] dark:border-[var(--cloud-700,#374151)]
      "
        />
    );
}

function EmployeeCard({ emp, onChange }: { emp: any; onChange: () => void }) {
    async function patch(payload: any) {
        const res = await fetch(`/api/employees/${emp._id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const j = await res.json().catch(()=> ({}));
            alert(j?.error || "Update failed");
        } else {
            onChange();
        }
    }

    return (
        <Card className="p-4">
            <div className="flex items-start justify-between">
                <div>
                    <div className="k-h2">{emp.name}</div>
                    <div className="text-xs k-muted">{emp.email ?? "—"}</div>
                    <div className="mt-1"><Badge>{emp.role}</Badge></div>
                </div>
                <div className="text-right">
                    <div className="text-xs k-muted mb-1">Enabled</div>
                    <Toggle
                        ariaLabel="Enable employee"
                        checked={!!emp.enabled}
                        onChange={(v)=>patch({ enabled: v })}
                    />
                </div>
            </div>

            <div className="mt-4 border-t pt-3">
                <div className="font-medium mb-2">Permissions</div>
                <div className="space-y-2">
                    <Row label="Send emails">
                        <Toggle checked={!!emp.permissions?.canSendEmails} onChange={(v)=>patch({ permissions: { ...emp.permissions, canSendEmails: v } })} />
                    </Row>
                    <Row label="Propose meeting times">
                        <Toggle checked={!!emp.permissions?.canProposeTimes} onChange={(v)=>patch({ permissions: { ...emp.permissions, canProposeTimes: v } })} />
                    </Row>
                    <Row label="Accept invites">
                        <Toggle checked={!!emp.permissions?.canAcceptInvites} onChange={(v)=>patch({ permissions: { ...emp.permissions, canAcceptInvites: v } })} />
                    </Row>
                    <Row label="Decline invites">
                        <Toggle checked={!!emp.permissions?.canDeclineInvites} onChange={(v)=>patch({ permissions: { ...emp.permissions, canDeclineInvites: v } })} />
                    </Row>
                    <Row label="Schedule meetings">
                        <Toggle checked={!!emp.permissions?.canScheduleMeetings} onChange={(v)=>patch({ permissions: { ...emp.permissions, canScheduleMeetings: v } })} />
                    </Row>
                </div>
            </div>

            <div className="mt-4 border-t pt-3">
                <div className="font-medium mb-2">Auto-approve</div>

                <div className="space-y-2">
                    <Row label="Auto send: normal replies">
                        <Toggle
                            checked={!!emp.auto?.sendWithoutApproval?.send_reply}
                            onChange={(v)=>patch({ auto: { ...emp.auto, sendWithoutApproval: { ...emp.auto?.sendWithoutApproval, send_reply: v } } })}
                        />
                        <span className="text-xs k-muted">min confidence</span>
                        <NumberInput
                            value={emp.auto?.thresholds?.send_reply ?? 0.9}
                            onChange={(v)=>patch({ auto: { ...emp.auto, thresholds: { ...emp.auto?.thresholds, send_reply: v } } })}
                        />
                    </Row>

                    <Row label="Auto send: calendar accept/decline">
                        <Toggle
                            checked={!!emp.auto?.sendWithoutApproval?.send_calendar_reply}
                            onChange={(v)=>patch({ auto: { ...emp.auto, sendWithoutApproval: { ...emp.auto?.sendWithoutApproval, send_calendar_reply: v } } })}
                        />
                        <span className="text-xs k-muted">min confidence</span>
                        <NumberInput
                            value={emp.auto?.thresholds?.send_calendar_reply ?? 0.85}
                            onChange={(v)=>patch({ auto: { ...emp.auto, thresholds: { ...emp.auto?.thresholds, send_calendar_reply: v } } })}
                        />
                    </Row>

                    <Row label="Auto schedule meeting">
                        <Toggle
                            checked={!!emp.auto?.sendWithoutApproval?.schedule_meeting}
                            onChange={(v)=>patch({ auto: { ...emp.auto, sendWithoutApproval: { ...emp.auto?.sendWithoutApproval, schedule_meeting: v } } })}
                        />
                        <span className="text-xs k-muted">min confidence</span>
                        <NumberInput
                            value={emp.auto?.thresholds?.schedule_meeting ?? 0.92}
                            onChange={(v)=>patch({ auto: { ...emp.auto, thresholds: { ...emp.auto?.thresholds, schedule_meeting: v } } })}
                        />
                    </Row>
                </div>
            </div>
        </Card>
    );
}
