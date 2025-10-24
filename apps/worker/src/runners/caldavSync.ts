// apps/worker/runners/caldavSync.ts
import { col } from '../db';
import { listDelta, parseIcs } from '../adapters/caldav';

type CalObj = { url: string; etag?: string; data?: string };

export async function startCalDAVSync() {
    setInterval(async () => {
        const conns = await (await col<any>('cal_connectors'))
            .find({ type: 'caldav', status: 'active' }).toArray();

        for (const c of conns as Array<any>) {
            try {
                const cache: CalObj[] = (c.cache as CalObj[] | undefined) ?? []; // [{ url, etag }]

                const {
                    created,          // CalObj[]
                    updated,          // CalObj[]
                    deleted,          // string[] (hrefs)
                    newSyncToken,     // string | undefined
                }: {
                    created: CalObj[]; updated: CalObj[]; deleted: string[]; newSyncToken?: string;
                } = await listDelta(
                    {
                        principalUrl: c.principalUrl as string,
                        calendarUrl: c.calendarUrl as string,
                        username: c.username as string,
                        password: /* decrypt */ (c.passwordEnc as string),
                        syncToken: c.syncToken as (string | undefined),
                    },
                    cache
                );

                const eventsCol = await col<any>('cal_events');

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
                            }
                        },
                        { upsert: true }
                    );
                }

                for (const href of (deleted ?? []) as string[]) {
                    await eventsCol.deleteOne({ tenantId: c.tenantId, href });
                }

                // Update connector cache + sync token
                const newCache: CalObj[] = [
                    ...created.map((o: CalObj) => ({ url: o.url, etag: o.etag })),
                    ...updated.map((o: CalObj) => ({ url: o.url, etag: o.etag })),
                    ...cache.filter((k: CalObj) => !(deleted ?? []).includes(k.url)),
                ];

                await (await col<any>('cal_connectors')).updateOne(
                    { _id: c._id },
                    {
                        $set: {
                            syncToken: newSyncToken,
                            cache: newCache,
                            status: 'active',
                            updatedAt: new Date(),
                        }
                    }
                );

            } catch (e) {
                console.warn('[caldav.sync] failed', c._id, e);
                await (await col<any>('cal_connectors')).updateOne(
                    { _id: c._id },
                    { $set: { status: 'error', lastError: String(e), updatedAt: new Date() } }
                );
            }
        }
    }, 60_000);
}
