// apps/worker/src/db.ts
import { MongoClient } from "mongodb";
const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "kadoo_dev";
const client = new MongoClient(uri);
export const mongo = client.db(dbName);
export async function ensureDb() {
    // @ts-ignore
    if (!client.topology?.isConnected?.())
        await client.connect();
}
export async function col(name) {
    await ensureDb();
    return mongo.collection(name);
}
