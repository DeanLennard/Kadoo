// apps/web/app/settings/page.tsx
"use client";
import { useState } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";

type ImapState = {
    host: string; port: number; secure: boolean; user: string; pass: string;
    tlsServername?: string;       // NEW
    allowSelfSigned?: boolean;    // NEW (only for known/trusted hosts)
};
type SmtpState = {
    host: string; port: number; secure: boolean; user: string; pass: string;
    tlsServername?: string;       // NEW
};

export default function SettingsPage() {
    const [imap, setImap] = useState<ImapState>({
        host: "imap.extendcp.co.uk",
        port: 143,                  // recommend STARTTLS by default
        secure: false,              // STARTTLS (false) vs implicit TLS (true/993)
        user: "", pass: "",
        tlsServername: "imap.extendcp.co.uk",
        allowSelfSigned: false,
    });

    const [smtp, setSmtp] = useState<SmtpState>({
        host: "mta.extendcp.co.uk",
        port: 587,                  // STARTTLS
        secure: false,
        user: "", pass: "",
        tlsServername: "mta.extendcp.co.uk",
    });

    const [busy, setBusy] = useState(false);
    const [ok, setOk] = useState<boolean|null>(null);

    async function save() {
        setBusy(true); setOk(null);
        try {
            const res = await fetch("/api/connectors/mail", {
                method:"POST",
                headers:{ "Content-Type":"application/json" },
                body: JSON.stringify({ imap, smtp }),
            });
            setOk(res.ok);
        } finally { setBusy(false); }
    }

    return (
        <main className="p-6 max-w-3xl mx-auto space-y-6">
            <h1 className="k-h1">Settings</h1>
            <Card className="space-y-4">
                <div className="k-h2">Mailbox (IMAP + SMTP)</div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* IMAP */}
                    <div>
                        <div className="k-title mb-2">IMAP</div>

                        <label className="block text-sm mb-1">Host</label>
                        <input className="w-full border rounded p-2"
                               value={imap.host}
                               onChange={e=>setImap({...imap,host:e.target.value})}/>

                        <div className="grid grid-cols-2 gap-2 mt-2">
                            <div>
                                <label className="block text-sm mb-1">Port</label>
                                <input className="w-full border rounded p-2" type="number"
                                       value={imap.port}
                                       onChange={e=>setImap({...imap,port:Number(e.target.value)})}/>
                            </div>
                            <label className="flex items-center gap-2 mt-6">
                                <input type="checkbox"
                                       checked={imap.secure}
                                       onChange={e=>setImap({...imap,secure:e.target.checked})}/>
                                secure (SSL/TLS)
                            </label>
                        </div>

                        {/* NEW: TLS servername (SNI) */}
                        <div className="mt-2">
                            <label className="block text-sm mb-1">TLS server name (SNI)</label>
                            <input className="w-full border rounded p-2"
                                   placeholder={imap.host}
                                   value={imap.tlsServername ?? ""}
                                   onChange={e=>setImap({...imap,tlsServername:e.target.value || undefined})}/>
                            <p className="text-xs k-muted mt-1">
                                Usually the same as host. Use the certificate’s CN/SAN if different.
                            </p>
                        </div>

                        {/* NEW: allow self-signed (guard-railed) */}
                        <label className="flex items-center gap-2 mt-2">
                            <input type="checkbox"
                                   checked={!!imap.allowSelfSigned}
                                   onChange={e=>setImap({...imap,allowSelfSigned:e.target.checked})}/>
                            Allow self-signed (trusted hosts only)
                        </label>

                        <div className="grid grid-cols-2 gap-2 mt-2">
                            <div>
                                <label className="block text-sm mb-1">User</label>
                                <input className="w-full border rounded p-2"
                                       value={imap.user}
                                       onChange={e=>setImap({...imap,user:e.target.value})}/>
                            </div>
                            <div>
                                <label className="block text-sm mb-1">Pass</label>
                                <input className="w-full border rounded p-2" type="password"
                                       value={imap.pass}
                                       onChange={e=>setImap({...imap,pass:e.target.value})}/>
                            </div>
                        </div>
                    </div>

                    {/* SMTP */}
                    <div>
                        <div className="k-title mb-2">SMTP</div>

                        <label className="block text-sm mb-1">Host</label>
                        <input className="w-full border rounded p-2"
                               value={smtp.host}
                               onChange={e=>setSmtp({...smtp,host:e.target.value})}/>

                        <div className="grid grid-cols-2 gap-2 mt-2">
                            <div>
                                <label className="block text-sm mb-1">Port</label>
                                <input className="w-full border rounded p-2" type="number"
                                       value={smtp.port}
                                       onChange={e=>setSmtp({...smtp,port:Number(e.target.value)})}/>
                            </div>
                            <label className="flex items-center gap-2 mt-6">
                                <input type="checkbox"
                                       checked={smtp.secure}
                                       onChange={e=>setSmtp({...smtp,secure:e.target.checked})}/>
                                secure (465)
                            </label>
                        </div>

                        {/* NEW: TLS servername (SNI) */}
                        <div className="mt-2">
                            <label className="block text-sm mb-1">TLS server name (SNI)</label>
                            <input className="w-full border rounded p-2"
                                   placeholder={smtp.host}
                                   value={smtp.tlsServername ?? ""}
                                   onChange={e=>setSmtp({...smtp,tlsServername:e.target.value || undefined})}/>
                        </div>

                        <div className="grid grid-cols-2 gap-2 mt-2">
                            <div>
                                <label className="block text-sm mb-1">User</label>
                                <input className="w-full border rounded p-2"
                                       value={smtp.user}
                                       onChange={e=>setSmtp({...smtp,user:e.target.value})}/>
                            </div>
                            <div>
                                <label className="block text-sm mb-1">Pass</label>
                                <input className="w-full border rounded p-2" type="password"
                                       value={smtp.pass}
                                       onChange={e=>setSmtp({...smtp,pass:e.target.value})}/>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex gap-3">
                    <Button onClick={save} disabled={busy}>
                        {busy ? "Saving…" : "Save connector"}
                    </Button>
                    {ok === true  && <span className="k-badge k-badge-mint">Saved</span>}
                    {ok === false && <span className="k-badge k-badge-warm">Failed</span>}
                </div>
            </Card>
        </main>
    );
}
