// apps/worker/src/index.ts
import "dotenv/config";
import { connection } from "./redis";
import "./queues";

async function main() {
    console.log("Worker starting…");
    console.log("Redis PING:", await connection.ping());

    // heartbeat
    setInterval(async () => {
        try {
            await connection.setex(`worker:heartbeat:${process.pid}`, 10, String(Date.now()));
        } catch (e) {
            console.error("Heartbeat failed:", e);
        }
    }, 5000);

    // keep alive
    process.stdin.resume();
}

process.on("SIGINT", async () => {
    console.log("Shutting down…");
    await connection.quit();
    process.exit(0);
});

main().catch((e) => {
    console.error("Worker fatal error:", e);
    process.exit(1);
});
