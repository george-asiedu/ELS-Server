import "dotenv/config";
import { env } from "./config/env.config";
import { bootstrapQueues, shutdownQueues } from "./queue";
import { startScheduler, stopScheduler } from "./scheduler/scheduler";
import { createTenantClient } from "./tenant/tenantClient";

// The background process: the queue workers (email, push, WhatsApp) and the
// recurring-job scheduler. It answers no web requests, so a slow job can never
// make the website or the app wait. In production it runs as its own service
// (zuri-worker) with a lower priority than the API.

if (env.appRole === "api") {
  console.error("APP_ROLE=api: this is the web process. Start dist/app.js, or set APP_ROLE=worker.");
  process.exit(1);
}

bootstrapQueues().catch((error) => console.error("Failed to start queues:", error));
if (env.schedulerEnabled) {
  startScheduler().catch((error) => console.error("Failed to start scheduler:", error));
} else {
  console.log("Scheduler off (SCHEDULER_ENABLED is not true): recurring jobs won't run here.");
}
console.log(`Worker running (role: ${env.appRole}).`);

let shuttingDown = false;
const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received: letting running jobs finish`);
  setTimeout(() => process.exit(1), 25_000).unref();
  void (async () => {
    await stopScheduler();
    await shutdownQueues().catch((e) => console.error("Error closing queues:", e));
    await createTenantClient().raw.$disconnect().catch(() => undefined);
    process.exit(0);
  })();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
