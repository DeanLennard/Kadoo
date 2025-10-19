// apps/web/lib/db.ts
import { MongoClient } from "mongodb";
import { loadEnv } from "@kadoo/config";

const env = loadEnv();
const client = new MongoClient(env.MONGODB_URI);
export const mongo = client.db(env.MONGODB_DB);
export async function ensureDb() { if (!client.topology?.isConnected()) await client.connect(); }
