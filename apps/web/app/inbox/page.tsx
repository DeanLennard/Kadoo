// apps/web/app/inbox/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import MessageBody from "@/components/mail/MessageBody";
import clsx from "clsx";
import ReplyBox from "@/components/mail/ReplyBox";
import ComposeModal from "@/components/mail/ComposeModal";
import Attachments from "@/components/mail/Attachments";

type Folder = { id: string; name: string; unread?: number };
type ThreadRow = { _id: string; subject: string; participants: string[]; lastTs: string | Date; unread?: number; labels?: string[]; };
type Message = { _id: string; from: string; to: string[]; date: string | Date; uid?: number; text?: string; html?: string; folder?: string; attachments?: any };
type ThreadData = { thread: { _id: string; subject: string; participants: string[] }, messages: Message[] };

// helper: time if <24h else D Mon
function formatLastTs(ts: string | Date) {
    const d = new Date(ts);
    const now = Date.now();
    const diffMs = now - d.getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    if (diffMs < dayMs) {
        // 24-hour time (UK style)
        return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    }
    // Day + 3-letter month e.g. 19 Oct
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }).replace(",", "");
}

const KNOWN_LABEL_COLORS: Record<string, string> = {
    spam: "bg-red-100 text-red-700 border-red-200",
    newsletter: "bg-sky-100 text-sky-700 border-sky-200",
    invoice: "bg-amber-100 text-amber-700 border-amber-200",
    billing: "bg-yellow-100 text-yellow-700 border-yellow-200",
    support: "bg-indigo-100 text-indigo-700 border-indigo-200",
    sales: "bg-emerald-100 text-emerald-700 border-emerald-200",
    intro: "bg-violet-100 text-violet-700 border-violet-200",
    personal: "bg-pink-100 text-pink-700 border-pink-200",
    calendar: "bg-cyan-100 text-cyan-700 border-cyan-200",
    legal: "bg-stone-100 text-stone-700 border-stone-200",
    hr: "bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200",
    ops: "bg-lime-100 text-lime-700 border-lime-200",
    shipping: "bg-teal-100 text-teal-700 border-teal-200",
    recruiting: "bg-rose-100 text-rose-700 border-rose-200",
    partner: "bg-blue-100 text-blue-700 border-blue-200",
    product: "bg-purple-100 text-purple-700 border-purple-200",
    "bug": "bg-orange-100 text-orange-700 border-orange-200",
    "feature-request": "bg-green-100 text-green-700 border-green-200",
};

const FALLBACK_PALETTE = [
    "bg-gray-100 text-gray-700 border-gray-200",
    "bg-slate-100 text-slate-700 border-slate-200",
    "bg-zinc-100 text-zinc-700 border-zinc-200",
    "bg-neutral-100 text-neutral-700 border-neutral-200",
    "bg-sky-100 text-sky-700 border-sky-200",
    "bg-emerald-100 text-emerald-700 border-emerald-200",
    "bg-violet-100 text-violet-700 border-violet-200",
    "bg-amber-100 text-amber-700 border-amber-200",
];

function hashLabel(s: string) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
    return Math.abs(h);
}

function badgeClass(label: string) {
    const key = label.toLowerCase();
    return (
        KNOWN_LABEL_COLORS[key] ||
        FALLBACK_PALETTE[hashLabel(key) % FALLBACK_PALETTE.length]
    );
}

function LabelBadge({ children }: { children: string }) {
    return (
        <span
            className={
                "inline-flex items-center px-2 py-[2px] rounded-full text-[10px] font-medium border " +
                badgeClass(children)
            }
            title={children}
        >
      {children}
    </span>
    );
}

export default function Inbox3Pane() {
    const { data: session, status } = useSession();
    const [folders, setFolders] = useState<Folder[]>([]);
    const [activeFolder, setActiveFolder] = useState<string>("INBOX");

    const [threads, setThreads] = useState<ThreadRow[]>([]);
    const [loadingThreads, setLoadingThreads] = useState(false);

    const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
    const [threadData, setThreadData] = useState<ThreadData | null>(null);
    const [loadingThread, setLoadingThread] = useState(false);
    const [loadingBody, setLoadingBody] = useState<Set<string>>(new Set());
    const [showCompose, setShowCompose] = useState(false);

    const msgKey = (m: Message) => `${m._id}`;

    // Load folders once
    useEffect(() => {
        fetch("/api/inbox/folders", { cache: "no-store" })
            .then(r => r.json())
            .then(d => setFolders(d.items || []))
            .catch(() => setFolders([{ id: "INBOX", name: "Inbox" }]));
    }, []);

    // Load threads whenever folder changes
    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoadingThreads(true);
            setActiveThreadId(null);
            setThreadData(null);

            // 1) kick an on-demand sync (best-effort)
            await fetch("/api/inbox/sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ folder: activeFolder }),
                cache: "no-store",
            }).catch(() => {});

            // 2) read from local DB
            const res = await fetch(`/api/inbox/threads?folder=${encodeURIComponent(activeFolder)}`, { cache: "no-store" });
            const data = await res.json();
            if (!cancelled) setThreads(data.items || []);
        })().finally(() => !cancelled && setLoadingThreads(false));
        return () => { cancelled = true; };
    }, [activeFolder]);

    // Load a thread’s messages
    async function openThread(id: string) {
        setActiveThreadId(id);
        setLoadingThread(true);
        try {
            const res = await fetch(`/api/inbox/thread?id=${encodeURIComponent(id)}`, { cache: "no-store" });
            const data: ThreadData = await res.json();
            setThreadData(data);

            // --- Auto-hydrate missing bodies ---
            const needs = (data.messages || []).filter(m => !(m.html?.trim() || m.text?.trim()) && m.uid);
            if (needs.length > 0) {
                // mark all as loading
                setLoadingBody(prev => {
                    const next = new Set(prev);
                    needs.forEach(m => next.add(msgKey(m)));
                    return next;
                });

                // hydrate one-by-one (keeps server load low and avoids IMAP contention)
                for (const m of needs) {
                    try {
                        await fetch("/api/inbox/fetch-message", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ threadId: data.thread._id, uid: m.uid, folder: m.folder }),
                            cache: "no-store",
                        });
                    } catch (_) {
                        // ignore and continue
                    } finally {
                        // clear loading flag for this message
                        setLoadingBody(prev => {
                            const next = new Set(prev);
                            next.delete(msgKey(m));
                            return next;
                        });
                    }
                }

                // re-open to pull the freshly stored html/text
                const res2 = await fetch(`/api/inbox/thread?id=${encodeURIComponent(id)}`, { cache: "no-store" });
                const data2 = await res2.json();
                setThreadData(data2);
            }
        } finally {
            setLoadingThread(false);
        }
    }

    async function deleteMessage(uid?: number, folder?: string) {
        if (!uid) return;
        await fetch("/api/inbox/delete", {
            method: "POST",
            headers: { "Content-Type":"application/json" },
            body: JSON.stringify({ threadId: threadData?.thread._id, uid, folder }),
        }).catch(()=>{});
        // refresh thread + thread list
        if (threadData?.thread?._id) openThread(threadData.thread._id);
    }

    const rightPane = useMemo(() => {
        if (!activeThreadId) {
            return <div className="h-full flex items-center justify-center text-sm k-muted">Select a thread</div>;
        }
        if (loadingThread || !threadData) {
            return <div className="p-4">Loading thread…</div>;
        }
        const { thread, messages } = threadData;

        const replySubject = thread.subject?.startsWith("Re:") ? thread.subject : `Re: ${thread.subject}`;

        return (
            <div className="p-4 space-y-4">
                <div>
                    <div className="k-h2">{thread.subject}</div>
                    <div className="text-sm k-muted">{thread.participants?.join(", ")}</div>
                    {Array.isArray((thread as any).labels) && (thread as any).labels.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                            {(thread as any).labels.map((l: string) => <LabelBadge key={l}>{l}</LabelBadge>)}
                        </div>
                    )}
                </div>
                <div className="space-y-3">
                    {messages.map(m => {
                        const me = session?.user?.email;
                        const replyTo = (thread.participants || [])
                            .map(e => e.toLowerCase())
                            .filter(e => e !== me?.toLowerCase());
                        const safeTo = replyTo.length ? replyTo : [m.from];

                        const isHydrating = loadingBody.has(msgKey(m));
                        const hasBody = !!(m.html?.trim() || m.text?.trim());

                        return (
                            <article key={m._id} className="border rounded-xl p-3">
                                {m.uid && (
                                    <div className="flex justify-end mb-2">
                                        <Button size="sm" variant="ghost" onClick={() => deleteMessage(m.uid!, m.folder)}>
                                            Delete
                                        </Button>
                                    </div>
                                )}
                                <div className="text-sm font-medium mb-1">{m.from}</div>
                                <div className="text-xs k-muted mb-2">{new Date(m.date).toLocaleString()}</div>

                                {hasBody ? (
                                    <>
                                        <MessageBody html={m.html} text={m.text} />
                                        <Attachments threadId={thread._id} uid={m.uid!} items={m.attachments as any} />
                                        <ReplyBox
                                            threadId={thread._id}
                                            to={Array.from(new Set(safeTo))}
                                            subject={replySubject}
                                            onSent={() => openThread(thread._id)} // refresh after sending
                                        />
                                    </>
                                ) : isHydrating ? (
                                    <div className="text-sm k-muted">Loading content…</div>
                                ) : (
                                    // (Optional) manual fallback action if you still want a button
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm k-muted">Body not cached.</span>
                                        <Button
                                            size="sm"
                                            onClick={async () => {
                                                setLoadingBody(prev => new Set(prev).add(msgKey(m)));
                                                try {
                                                    await fetch("/api/inbox/fetch-message", {
                                                        method: "POST",
                                                        headers: { "Content-Type": "application/json" },
                                                        body: JSON.stringify({ threadId: threadData!.thread._id, uid: m.uid, folder: m.folder }),
                                                        cache: "no-store",
                                                    });
                                                    // patch refresh
                                                    await openThread(threadData!.thread._id);
                                                } finally {
                                                    setLoadingBody(prev => {
                                                        const next = new Set(prev);
                                                        next.delete(msgKey(m));
                                                        return next;
                                                    });
                                                }
                                            }}
                                        >
                                            Load content
                                        </Button>
                                    </div>
                                )}
                            </article>
                        );
                    })}
                </div>
            </div>
        );
    }, [activeThreadId, loadingThread, threadData]);

    return (
        <main className="p-0 h-[calc(100vh-64px)]"> {/* assume header is ~64px */}
            <div className="grid grid-cols-[240px_1fr_1.4fr] h-full">
                {/* FOLDERS */}
                <aside className="border-r bg-[var(--cloud)] p-3 overflow-auto">
                    <div className="k-title px-2 mb-2">
                        <Button size="sm" onClick={() => setShowCompose(true)}>New</Button>
                        <Button
                            size="sm"
                            onClick={async () => {
                                await fetch("/api/inbox/sync", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ folder: activeFolder }),
                                }).catch(()=>{});
                                const res = await fetch(`/api/inbox/threads?folder=${encodeURIComponent(activeFolder)}`, { cache: "no-store" });
                                const data = await res.json();
                                setThreads(data.items || []);
                            }}
                        >
                            Refresh
                        </Button>
                    </div>
                    <div className="k-title px-2 mb-2">Folders</div>
                    <ul className="space-y-1">
                        {folders.map(f => (
                            <li key={f.id}>
                                <button
                                    className={clsx(
                                        "w-full text-left px-3 py-2 rounded-lg hover:bg-white",
                                        activeFolder === f.id && "bg-white shadow-sm"
                                    )}
                                    onClick={() => setActiveFolder(f.id)}
                                >
                                    <div className="flex items-center justify-between">
                                        <span>{f.name}</span>
                                        {!!f.unread && <span className="k-badge k-badge-warm">{f.unread}</span>}
                                    </div>
                                </button>
                            </li>
                        ))}
                    </ul>
                </aside>

                {/* THREAD LIST */}
                <section className="border-r overflow-auto">
                    <div className="sticky top-0 p-3 bg-white border-b">
                        <div className="k-h2">Inbox</div>
                        <div className="text-xs k-muted">{activeFolder}</div>
                    </div>

                    {loadingThreads && <div className="p-4">Loading…</div>}

                    <ul className="divide-y">
                        {threads.map(t => {
                            const isUnread = (t.unread ?? 0) > 0;
                            return (
                                <li key={t._id}>
                                    <button
                                        className={clsx(
                                            "w-full text-left p-3 hover:bg-[var(--cloud)] transition",
                                            activeThreadId === t._id && "bg-[var(--cloud)]",
                                            isUnread && "bg-[var(--cloud)]/70" // subtle highlight for unread
                                        )}
                                        onClick={() => openThread(t._id)}
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <div className={clsx("truncate", isUnread ? "font-semibold" : "font-medium")}>
                                                {t.subject}
                                            </div>
                                            <div className="text-xs k-muted shrink-0">
                                                {formatLastTs(t.lastTs)}
                                            </div>
                                        </div>
                                        <div className={clsx("text-xs truncate", isUnread ? "font-semibold" : "k-muted")}>
                                            {t.participants?.join(", ")}
                                        </div>
                                        {/* badges */}
                                        {t.labels?.length ? (
                                            <div className="mt-1 flex flex-wrap gap-1">
                                                {t.labels.slice(0, 6).map(l => (
                                                    <LabelBadge key={l}>{l}</LabelBadge>
                                                ))}
                                                {t.labels.length > 6 && (
                                                    <span className="text-[10px] k-muted">+{t.labels.length - 6} more</span>
                                                )}
                                            </div>
                                        ) : null}
                                    </button>
                                </li>
                            );
                        })}
                        {!loadingThreads && threads.length === 0 && (
                            <li className="p-4 text-sm k-muted">No threads.</li>
                        )}
                    </ul>
                </section>

                {/* MESSAGE VIEW */}
                <section className="overflow-auto">
                    {rightPane}
                </section>
            </div>
            {showCompose && (
                <ComposeModal onClose={()=>setShowCompose(false)} onSent={()=>{ setShowCompose(false); /* optionally refresh Sent */ }} />
            )}
        </main>
    );
}
