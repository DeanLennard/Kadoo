// apps/web/lib/db.ts
import { MongoClient, type Document, type Collection } from "mongodb";
import { loadEnv } from "@kadoo/config";

const env = loadEnv();
const client = new MongoClient(env.MONGODB_URI);
export const mongo = client.db(env.MONGODB_DB);

export async function ensureDb() {
    // @ts-ignore (Mongo v6 internal)
    if (!client.topology?.isConnected?.()) await client.connect();
}

// Note: T is your plain interface; we return Collection<T & Document>
export async function col<T>(name: string): Promise<Collection<T & Document>> {
    await ensureDb();
    return mongo.collection<T & Document>(name);
}
