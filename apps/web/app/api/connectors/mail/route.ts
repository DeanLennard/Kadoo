// apps/web/app/api/connectors/mail/route.ts
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { col } from "@/lib/db";
import { requireSession } from "@/lib/auth";

export async function POST(req: Request) {
    const { tenantId } = await requireSession();
    const body = await req.json();

    const imap = body.imap ?? {};
    const smtp = body.smtp ?? {};
    const connectorId: string | undefined = body._id;

    const now = new Date();

    // Build $set entirely with dotted paths (no whole-object set)
    const $set: Record<string, any> = {
        tenantId,
        type: "imap",
        status: "active",
        updatedAt: now,

        "imap.host": String(imap.host ?? ""),
        "imap.port": Number(imap.port ?? 143),
        "imap.secure": Boolean(imap.secure ?? false),
        "imap.user": String(imap.user ?? ""),
        "imap.tlsServername": imap.tlsServername ? String(imap.tlsServername) : undefined,
        "imap.allowSelfSigned": Boolean(imap.allowSelfSigned ?? false),

        "smtp.host": String(smtp.host ?? ""),
        "smtp.port": Number(smtp.port ?? 587),
        "smtp.secure": Boolean(smtp.secure ?? false),
        "smtp.user": String(smtp.user ?? ""),
        "smtp.tlsServername": smtp.tlsServername ? String(smtp.tlsServername) : undefined,
    };

    // Only write passwords if present (so you don’t blank them on save)
    if (imap.pass) $set["imap.pass"] = String(imap.pass);
    if (smtp.pass) $set["smtp.pass"] = String(smtp.pass);

    // Remove undefineds so Mongo doesn’t write them explicitly
    for (const k of Object.keys($set)) {
        if ($set[k] === undefined) delete $set[k];
    }

    const $setOnInsert = { createdAt: now };

    const connectors = await col("MailboxConnector");
    const filter = connectorId
        ? { _id: new ObjectId(connectorId), tenantId }
        : {
            tenantId,
            type: "imap",
            "imap.user": $set["imap.user"],
            "imap.host": $set["imap.host"],
        };

    const res = await connectors.updateOne(filter, { $set, $setOnInsert }, { upsert: true });

    const doc =
        res.upsertedId
            ? await connectors.findOne({ _id: res.upsertedId })
            : await connectors.findOne(filter, { projection: { _id: 1 } });

    return NextResponse.json({ ok: true, _id: doc?._id });
}
