// apps/web/app/inbox/[id]/page.tsx
"use server";
import { col } from "@/lib/db";
import type { MailMessage, MailThread } from "@kadoo/types"; // use shared types
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import { requireSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";

async function getData(tenantId: string, id: string) {
    const threads = await col<MailThread>("MailThread");
    const t = await threads.findOne({ _id: id, tenantId });
    if (!t) return null;
    const msgs = await (await col<MailMessage>("MailMessage"))
        .find({ tenantId, threadId: id })
        .sort({ date: 1 })
        .toArray();
    return { t, msgs };
}

export default async function ThreadPage({ params }: { params: { id: string } }) {
    const { tenantId } = await requireSession();
    const threadId = decodeURIComponent(params.id);
    const data = await getData(tenantId, threadId);
    if (!data) return <main className="p-6">Not found</main>;

    async function draftReply(formData: FormData) {
        "use server";
        // re-derive tenantId on the server action (no client data trust)
        const { tenantId } = await requireSession();

        const threadId = String(formData.get("threadId") || "");
        if (!threadId) throw new Error("Missing threadId");

        // fetch the thread again to ensure it belongs to this tenant
        const threads = await col<MailThread>("MailThread");
        const t = await threads.findOne({ _id: threadId, tenantId });
        if (!t) throw new Error("Thread not found");

        const body_md = String(formData.get("body_md") || "");
        const to = (t.participants?.filter(e => e.includes("@")) || []).slice(0, 1);

        const logs = await col("DecisionLog");
        await logs.insertOne({
            tenantId,
            employeeId: "ea-1",
            createdAt: new Date(),
            status: "pending",
            requiresApproval: true,
            confidence: 0.88,
            action: {
                type: "create_draft_reply",
                payload: { threadId: t._id, to, subject: `Re: ${t.subject}`, body_md }
            }
        });
    }

    async function ensureBody(uid: number) {
        "use server";
        await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/api/inbox/fetch-message`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ threadId, uid }),
            cache: "no-store",
        });
        // Re-fetch data for this page
        revalidatePath(`/inbox/${encodeURIComponent(threadId)}`);
    }

    return (
        <main className="p-6 max-w-4xl mx-auto space-y-4">
            <Card>
                <div className="k-h2 mb-2">{data.t.subject}</div>
                <div className="text-sm k-muted mb-4">{data.t.participants.join(", ")}</div>

                <div className="space-y-3">
                    {data.msgs.map(m => (
                        <article key={m._id} className="border rounded-xl p-3">
                            <div className="text-sm font-medium mb-1">{m.from}</div>
                            <div className="text-xs k-muted mb-2">{new Date(m.date).toLocaleString()}</div>

                            {m.text && m.text.length > 0 ? (
                                <pre className="text-sm bg-[var(--cloud)] rounded p-3 overflow-auto">{m.text}</pre>
                            ) : (
                                <form action={async () => ensureBody(m.uid!)} className="flex items-center gap-2">
                                    <span className="text-sm k-muted">Body not cached.</span>
                                    <Button type="submit" size="sm">Load content</Button>
                                </form>
                            )}
                        </article>
                    ))}
                </div>
            </Card>

            <Card>
                <form action={draftReply} className="space-y-3">
                    <input type="hidden" name="threadId" value={data.t._id} />
                    <div className="k-h2">Draft reply</div>
                    <textarea name="body_md" rows={6} className="w-full border rounded p-3" placeholder="Write a reply…" />
                    <Button type="submit">Propose draft (needs approval)</Button>
                </form>
            </Card>
        </main>
    );
}
