// apps/web/app/dashboard/page.tsx
"use client";
import { useSession, signOut } from "next-auth/react";
import TestButton from "./TestButton";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import EventStream from "./EventStream";

export default function Dashboard() {
    const { data: session, status } = useSession();

    if (status === "loading") return <main className="p-6 max-w-5xl mx-auto space-y-6">Loading session…</main>;
    if (status === "unauthenticated")
        return (
            <main className="p-6 max-w-5xl mx-auto space-y-6">
                <Card>
                    <div className="k-h2 mb-2">You’re not signed in</div>
                    <p className="k-muted">Please <a className="underline" href="/login">log in</a> to continue.</p>
                </Card>
            </main>
        );

    const tenantId = (session as any).tenantId;
    const role = (session as any).role;

    return (
        <main className="p-6 max-w-5xl mx-auto space-y-6">
            {/* Top bar */}
            <div className="flex items-center gap-4">
                <div className="flex-1">
                    <div className="k-h1">Kadoo Dashboard</div>
                    <div className="text-sm k-muted">
                        Welcome <span className="font-medium">{session?.user?.email}</span> • Tenant&nbsp;
                        <code className="bg-[var(--cloud)] px-1.5 py-0.5 rounded">{tenantId}</code>
                        &nbsp;• <Badge>{role}</Badge>
                    </div>
                </div>
                <TestButton />
                <button
                    className="k-btn k-btn-ghost"
                    onClick={() => signOut({ callbackUrl: "/login" })}
                >
                    Sign out
                </button>
            </div>

            {/* At-a-glance cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                    <div className="k-muted text-xs mb-1">Credits</div>
                    <div className="k-title">5,000</div>
                    <div className="text-xs k-muted">pooled • resets on the 1st</div>
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
        </main>
    );
}
