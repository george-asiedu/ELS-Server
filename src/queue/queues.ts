import { Queue } from "bullmq";
import { getRedisConnection, isQueueEnabled } from "./connection";

// Job payload for a single transactional email. Kept as plain serialisable
// data (no class instances) since BullMQ persists it as JSON in Redis.
export interface EmailJobData {
  to: string;
  subject: string;
  html: string;
}

export interface ReconcilePaymentsJobData {
  // No input needed — the job sweeps the whole platform on a schedule. Kept as
  // an (empty) type so the queue is typed end to end.
  triggeredBy?: "cron" | "manual";
}

const QUEUE_NAMES = {
  email: "email",
  reconcilePayments: "reconcile-payments",
} as const;

// Queues are only constructed when Redis is configured. Callers must check
// `isQueueEnabled()` (or just use the `enqueueEmail`/`enqueueReconciliation`
// helpers below, which already fall back gracefully).
export const emailQueue = isQueueEnabled()
  ? new Queue<EmailJobData>(QUEUE_NAMES.email, {
      connection: getRedisConnection()!,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 30_000 }, // 30s, 60s, 2m, 4m, 8m
        removeOnComplete: { age: 60 * 60 * 24, count: 500 }, // keep 24h / 500 jobs
        removeOnFail: { age: 60 * 60 * 24 * 7 }, // keep failures 7 days for review
      },
    })
  : null;

export const reconcilePaymentsQueue = isQueueEnabled()
  ? new Queue<ReconcilePaymentsJobData>(QUEUE_NAMES.reconcilePayments, {
      connection: getRedisConnection()!,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: { age: 60 * 60 * 24 * 3, count: 100 },
        removeOnFail: { age: 60 * 60 * 24 * 14 },
      },
    })
  : null;

export { QUEUE_NAMES };
