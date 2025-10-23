// apps/web/lib/mongo.ts
import { MongoClient } from "mongodb";
import { loadEnv } from "@kadoo/config";

const env = loadEnv();

// Create one client for Next.js app (reuse across routes)
const client = new MongoClient(env.MONGODB_URI);

// NextAuth adapter expects a Promise<MongoClient>
export const clientPromise = client.connect();
export const databaseName = env.MONGODB_DB;
