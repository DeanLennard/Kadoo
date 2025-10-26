// apps/worker/src/runners/caldavSync.ts
import { col } from "../db";
import { listDelta, listRange, parseIcs, listCollections, makeAgentForUrl, normaliseCalUrl } from "../adapters/caldav";
import { decrypt } from "@kadoo/server-utils/secrets";

type CalObj = { url: string; etag?: string; data?: string };

const SYNC_INTERVAL_MS = 60_000;
const SEED_LOOKBACK_DAYS = 365;
const LOOKAHEAD_DAYS = 365;

export async function startCalDAVSync() {
    console.log("[caldav.sync] starting");

    // one-shot tick immediately (don’t wait a minute)
    tick().catch(err => console.warn("[caldav.sync] boot tick failed", err));

    setInterval(() => {
        tick().catch(err => console.warn("[caldav.sync] interval tick failed", err));
    }, SYNC_INTERVAL_MS);
}

async function tick() {
    const conns = await (await col<any>("cal_connectors"))
        .find({ type: "caldav", status: "active" })
        .toArray();

    console.log("[caldav.sync] active connectors:", conns.length);

    for (const c of conns as any[]) {
        try {

            if (c.homeUrl) {
                const base =
                    c.homeUrl.startsWith("http")
                        ? c.homeUrl
                        : `https://${new URL(c.calendarUrl).host}${c.homeUrl}`;
                const agent = makeAgentForUrl(normaliseCalUrl(c.calendarUrl), {
                    tlsServername: c.tlsServername,
                    allowSelfSigned: c.allowSelfSigned,
                });
                const disc = await listCollections(base, { username: c.username, password: c.passwordEnc }, { agent });
                console.log("[caldav.discovery.raw]", base, disc.status, disc.body.slice(0, 800));
            }

            const cache: CalObj[] = (c.cache as CalObj[] | undefined) ?? [];
            const hasSeed = cache.length > 0 || typeof c.syncToken === "string";
            const pw = decrypt ? decrypt(c.passwordEnc) : c.passwordEnc;

            // ---- SEED: first-time full range fetch ----
            if (!hasSeed) {
                const now = Date.now();
                const startISO = new Date(now - SEED_LOOKBACK_DAYS * 86400_000).toISOString();
                const endISO = new Date(now + LOOKAHEAD_DAYS * 86400_000).toISOString();

                console.log("[caldav.sync] seeding", c._id, { startISO, endISO });
                const objs = await listRange(
                    {
                        principalUrl: c.principalUrl,
                        calendarUrl: c.calendarUrl,
                        username: c.username,
                        password: pw,
                        tlsServername: c.tlsServername,
                        allowSelfSigned: !!c.allowSelfSigned,
                    },
                    startISO,
                    endISO
                );

                const eventsCol = await col<any>("cal_events");
                let upserts = 0;

                for (const obj of objs ?? []) {
                    if (!obj?.data) continue;
                    const norm = parseIcs(obj.data);
                    await eventsCol.updateOne(
                        { tenantId: c.tenantId, uid: norm.uid },
                        {
                            $set: {
                                ...norm,
                                connectorId: c._id,
                                rawIcs: obj.data,
                                updatedAt: new Date(),
                                etag: obj.etag,
                                href: obj.url,
                            },
                        },
                        { upsert: true }
                    );
                    upserts++;
                }

                const newCache: CalObj[] = (objs ?? []).map((o: any) => ({ url: o.url, etag: o.etag }));
                await (await col<any>("cal_connectors")).updateOne(
                    { _id: c._id },
                    {
                        $set: {
                            cache: newCache,
                            // some servers issue sync-token only after REPORT; leave undefined if none
                            status: "active",
                            updatedAt: new Date(),
                        },
                    }
                );

                console.log("[caldav.sync] seed complete", c._id, { upserts, cache: newCache.length });
                // continue to next connector; deltas will kick in next tick
                continue;
            }

            // ---- DELTA SYNC ----
            const { created, updated, deleted, newSyncToken } = await listDelta(
                {
                    principalUrl: c.principalUrl,
                    calendarUrl: c.calendarUrl,
                    username: c.username,
                    password: pw,
                    tlsServername: c.tlsServername,
                    allowSelfSigned: !!c.allowSelfSigned,
                    syncToken: c.syncToken,
                },
                cache
            );

            const eventsCol = await col<any>("cal_events");
            let upserts = 0, deletes = 0;

            for (const obj of [...created, ...updated]) {
                if (!obj?.data) continue;
                const norm = parseIcs(obj.data);
                await eventsCol.updateOne(
                    { tenantId: c.tenantId, uid: norm.uid },
                    {
                        $set: {
                            ...norm,
                            connectorId: c._id,
                            rawIcs: obj.data,
                            updatedAt: new Date(),
                            etag: obj.etag,
                            href: obj.url,
                        },
                    },
                    { upsert: true }
                );
                upserts++;
            }

            for (const href of deleted ?? []) {
                await eventsCol.deleteOne({ tenantId: c.tenantId, href });
                deletes++;
            }

            const newCache: CalObj[] = [
                ...created.map((o: CalObj) => ({ url: o.url, etag: o.etag })),
                ...updated.map((o: CalObj) => ({ url: o.url, etag: o.etag })),
                ...cache.filter((k: CalObj) => !(deleted ?? []).includes(k.url)),
            ];

            await (await col<any>("cal_connectors")).updateOne(
                { _id: c._id },
                {
                    $set: {
                        syncToken: newSyncToken,
                        cache: newCache,
                        status: "active",
                        updatedAt: new Date(),
                    },
                }
            );

            console.log("[caldav.sync] delta", c._id, {
                created: created.length,
                updated: updated.length,
                deleted: (deleted ?? []).length,
                upserts,
                cache: newCache.length,
                syncToken: Boolean(newSyncToken),
            });

        } catch (e: any) {
            const code = e?.code || e?.errno || "";
            const transient = ["EAI_AGAIN", "ECONNRESET", "ETIMEDOUT", "EPIPE"].includes(code);
            console.warn("[caldav.sync] failed", c._id, code, e?.message ?? e);
            await (await col<any>("cal_connectors")).updateOne(
                { _id: c._id },
                {
                    $set: {
                        status: transient ? "active" : "error",
                        lastError: `${code}:${e?.message ?? e}`,
                        updatedAt: new Date(),
                    },
                    ...(transient ? { $setOnInsert: {} } : {}),
                }
            );
        }
    }
}
