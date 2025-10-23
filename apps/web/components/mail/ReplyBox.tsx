// apps/web/components/mail/ReplyBox.tsx
"use client";
import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import Button from "@/components/ui/Button";
import "react-quill-new/dist/quill.snow.css";

// load client-side only
const ReactQuill = dynamic(() => import("react-quill-new"), { ssr: false });

type Props = {
    threadId: string;
    to: string[];
    subject: string;
    onSent?: () => void;
};

export default function ReplyBox({ threadId, to, subject, onSent }: Props) {
    const [html, setHtml] = useState("");
    const [busy, setBusy] = useState(false);
    const [cc, setCc] = useState<string>("");
    const fileRef = useRef<HTMLInputElement>(null);
    const [files, setFiles] = useState<File[]>([]);

    async function send() {
        if (!html.trim()) return;
        setBusy(true);
        try {
            const fd = new FormData();
            fd.append("threadId", threadId);
            fd.append("subject", subject);
            to.forEach(v => fd.append("to[]", v));
            cc.split(",").map(s => s.trim()).filter(Boolean).forEach(v => fd.append("cc[]", v));
            fd.append("html", html);
            fd.append("text", html.replace(/<[^>]+>/g, ""));

            for (const f of files) fd.append("attachments", f, f.name);

            const res = await fetch("/api/inbox/reply", { method: "POST", body: fd });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || "send failed");
            }
            setHtml(""); setCc(""); setFiles([]); fileRef.current && (fileRef.current.value = "");
            onSent?.();
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="border rounded-xl p-3 space-y-2">
            <div className="text-xs k-muted">To: {to.join(", ")}</div>
            <div className="text-xs k-muted">Subject: {subject}</div>
            <input
                className="w-full border rounded p-2 text-sm"
                placeholder="Cc (comma separated)"
                value={cc}
                onChange={e => setCc(e.target.value)}
            />
            <input
                ref={fileRef}
                type="file"
                multiple
                className="block text-sm"
                onChange={e => setFiles(Array.from(e.target.files || []))}
            />
            <ReactQuill theme="snow" value={html} onChange={setHtml} />
            <div className="flex justify-end">
                <Button onClick={send} disabled={busy}>
                    {busy ? "Sending…" : "Send"}
                </Button>
            </div>
        </div>
    );
}
