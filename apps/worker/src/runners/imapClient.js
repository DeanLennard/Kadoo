// apps/worker/src/runners/imapClient.ts
import { ImapFlow } from "imapflow";
const RELAXED_TLS_HOST_ALLOWLIST = [/\.extendcp\.co\.uk$/i, /(^|\.)kadoo\.io$/i];
const canRelax = (host, allowSelfSigned) => !!allowSelfSigned && RELAXED_TLS_HOST_ALLOWLIST.some(re => re.test(host));
async function tryConnect(opts) {
    const c = new ImapFlow(opts);
    c.on("error", e => console.error("[imap] client error", e));
    await c.connect();
    return c;
}
export async function createImapClient(conn) {
    if (!conn.imap)
        throw new Error("No IMAP config");
    const { host, user, pass, allowSelfSigned } = conn.imap;
    const relax = canRelax(host, allowSelfSigned);
    // STARTTLS first
    try {
        return await tryConnect({
            host,
            port: 143,
            secure: false,
            auth: { user, pass },
            tls: { rejectUnauthorized: !relax },
            logger: false,
        });
    }
    catch { }
    // implicit TLS fallback
    return tryConnect({
        host,
        port: 993,
        secure: true,
        auth: { user, pass },
        tls: { rejectUnauthorized: !relax },
        logger: false,
    });
}
