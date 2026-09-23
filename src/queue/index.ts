import { isQueueEnabled, getRedisConnection } from "./connection";
import { reconcilePaymentsQueue, billingRemindersQueue, QUEUE_NAMES } from "./queues";
import { createEmailWorker } from "./workers/emailWorker";
import { createReconcileWorker } from "./workers/reconcileWorker";
import { createBillingReminderWorker } from "./workers/billingReminderWorker";

// Call once at boot (see app.ts). No-ops entirely when REDIS_URL isn't set —
// see queue/README.md for what that means for email sending and the
// reconciliation sweep in that case.
export const bootstrapQueues = async (): Promise<void> => {
  if (!isQueueEnabled()) {
    console.log(
      "REDIS_URL not set — queues disabled: emails send inline, no payment reconciliation sweep. See src/queue/README.md.",
    );
    return;
  }

  // Verify Redis is actually reachable before wiring up workers/repeatable
  // jobs, so a bad REDIS_URL fails loudly at boot instead of silently dropping
  // every job.
  const connection = getRedisConnection();
  try {
    await connection!.ping();
  } catch (error) {
    console.error(
      "REDIS_URL is set but Redis is unreachable — queues disabled:",
      error instanceof Error ? error.message : error,
    );
    return;
  }

  createEmailWorker();
  createReconcileWorker();
  createBillingReminderWorker();

  // Repeatable job: sweep for stale pending payments/orders every 15 minutes.
  // upsertJobScheduler is idempotent — safe to call on every boot/deploy
  // without creating duplicate schedules.
  await reconcilePaymentsQueue!.upsertJobScheduler(
    "reconcile-payments-cron",
    { pattern: "*/15 * * * *" },
    { name: "sweep", data: { triggeredBy: "cron" } },
  );

  // Repeatable job: check for studios whose subscription period is expiring
  // soon or has lapsed, once a day.
  await billingRemindersQueue!.upsertJobScheduler(
    "billing-reminders-cron",
    { pattern: "0 8 * * *" },
    { name: "sweep", data: { triggeredBy: "cron" } },
  );

  console.log(
    `Queues online: "${QUEUE_NAMES.email}" (background email), "${QUEUE_NAMES.reconcilePayments}" (every 15 min), and "${QUEUE_NAMES.billingReminders}" (daily).`,
  );
};
