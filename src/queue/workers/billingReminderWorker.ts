import { Worker } from "bullmq";
import { getRedisConnection } from "../connection";
import { QUEUE_NAMES, BillingRemindersJobData } from "../queues";
import { StudioService } from "../../studio/studioService";
import { S3BucketService } from "../../bucket/s3BucketService";

// Runs the subscription billing-reminder sweep (see
// StudioService.checkBillingReminders) whenever the repeatable job fires.
export const createBillingReminderWorker = (): Worker<BillingRemindersJobData> => {
  const connection = getRedisConnection();
  if (!connection) {
    throw new Error("createBillingReminderWorker called without a Redis connection");
  }

  const studioService = new StudioService(new S3BucketService());

  const worker = new Worker<BillingRemindersJobData>(
    QUEUE_NAMES.billingReminders,
    async () => {
      const result = await studioService.checkBillingReminders();
      if (result.expiringSoon > 0 || result.expired > 0) {
        console.log("Billing reminders:", result);
      }
      return result;
    },
    {
      connection,
      concurrency: 1,
    },
  );

  worker.on("failed", (job, err) => {
    console.error(`Billing reminder job ${job?.id} failed: ${err.message}`);
  });

  return worker;
};
