import { Queue } from "bullmq";
import { getRedisConnection, isQueueEnabled } from "./connection";
import type { EmailAttachment } from "../email/emailService";

// Job payload for a single transactional email. Kept as plain serialisable
// data (no class instances) since BullMQ persists it as JSON in Redis.
export interface EmailJobData {
  to: string;
  subject: string;
  html: string;
  // Base64 attachments (receipt PDFs). Receipts are only a few KB, so carrying
  // them in the job payload is fine; anything large should be uploaded to S3
  // and linked instead of persisted into Redis.
  attachments?: EmailAttachment[];
}

const QUEUE_NAMES = {
  email: "email",
} as const;

// Queues that used to carry the recurring jobs before they moved to the
// database-backed scheduler (src/scheduler). Their keys are removed once at
// boot — see retireLegacyQueues in index.ts.
export const LEGACY_QUEUE_NAMES = [
  "reconcile-payments",
  "billing-reminders",
  "booking-reminders",
] as const;

// Only constructed when Redis is configured; NotificationService falls back to
// sending inline when this is null.
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

export { QUEUE_NAMES };
