// apps/worker/src/runners/index.ts
import { col } from "../db";
import { createImapClient } from "./imapClient";
import { runImapIdle } from "./imapIdle";
import { startCalDAVSync } from './caldavSync';
export async function startRunners() {
    const connectors = await col("MailboxConnector");
    const all = await connectors.find({ status: "active", type: "imap" }).toArray();
    for (const conn of all) {
        void (async function loop() {
            while (true) {
                try {
                    const client = await createImapClient(conn); // handles strict/relaxed
                    await runImapIdle(conn, client); // returns only on error
                }
                catch (e) {
                    console.error("imap start/loop failed", conn._id, e);
                    await new Promise(r => setTimeout(r, 5000)); // small backoff before recreating
                }
            }
        })();
    }
    startCalDAVSync();
}
