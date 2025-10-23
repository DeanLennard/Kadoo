// apps/web/components/mail/ComposeModal.tsx
"use client";
import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import Button from "@/components/ui/Button";
import "react-quill-new/dist/quill.snow.css";
const ReactQuill = dynamic(() => import("react-quill-new"), { ssr: false });

export default function ComposeModal({ onClose, onSent }: { onClose:()=>void; onSent:()=>void }) {
    const [to, setTo] = useState("");
    const [cc, setCc] = useState("");
    const [subject, setSubject] = useState("");
    const [html, setHtml] = useState("");
    const [busy, setBusy] = useState(false);

    const fileRef = useRef<HTMLInputElement>(null);
    const [files, setFiles] = useState<File[]>([]);

    async function send() {
        setBusy(true);
        try {
            const fd = new FormData();
            to.split(",").map(s => s.trim()).filter(Boolean).forEach(v => fd.append("to[]", v));
            cc.split(",").map(s => s.trim()).filter(Boolean).forEach(v => fd.append("cc[]", v));
            fd.append("subject", subject);
            fd.append("html", html);
            fd.append("text", html.replace(/<[^>]+>/g, "")); // plain fallback
            for (const f of files) fd.append("attachments", f, f.name);

            const res = await fetch("/api/inbox/compose", { method: "POST", body: fd });
            const j = await res.json().catch(()=> ({}));
            if (!res.ok) throw new Error(j.error || "send failed");

            // reset
            setTo(""); setCc(""); setSubject(""); setHtml("");
            setFiles([]);
            if (fileRef.current) fileRef.current.value = "";
            onSent();
        } finally { setBusy(false); }
    }

    return (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-4 space-y-3">
                <div className="flex justify-between items-center">
                    <div className="k-h2">New message</div>
                    <button onClick={onClose} className="k-link">Close</button>
                </div>
                <input className="w-full border rounded p-2" placeholder="To" value={to} onChange={e=>setTo(e.target.value)} />
                <input className="w-full border rounded p-2" placeholder="Cc" value={cc} onChange={e=>setCc(e.target.value)} />
                <input className="w-full border rounded p-2" placeholder="Subject" value={subject} onChange={e=>setSubject(e.target.value)} />

                <input
                    ref={fileRef}
                    type="file"
                    multiple
                    className="block text-sm"
                    onChange={e => setFiles(Array.from(e.target.files || []))}
                />
                {!!files.length && (
                    <div className="text-xs k-muted">
                        {files.map(f => f.name).join(", ")}
                    </div>
                )}

                <ReactQuill theme="snow" value={html} onChange={setHtml} />
                <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button onClick={send} disabled={busy || !to || !subject}>{busy ? "Sending…" : "Send"}</Button>
                </div>
            </div>
        </div>
    );
}
