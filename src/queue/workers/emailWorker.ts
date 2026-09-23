import { Worker } from "bullmq";
import { getRedisConnection } from "../connection";
import { QUEUE_NAMES, EmailJobData } from "../queues";
import { sendEmailNow } from "../../email/emailService";

// Processes queued emails in the background. Retries/backoff are configured on
// the queue side (see queues.ts); this worker just does the send and lets
// BullMQ re-run the job on failure.
export const createEmailWorker = (): Worker<EmailJobData> => {
  const connection = getRedisConnection();
  if (!connection) {
    throw new Error("createEmailWorker called without a Redis connection");
  }

  const worker = new Worker<EmailJobData>(
    QUEUE_NAMES.email,
    async (job) => {
      await sendEmailNow(job.data);
    },
    {
      connection,
      concurrency: 5,
    },
  );

  worker.on("failed", (job, err) => {
    console.error(
      `Email job ${job?.id} failed (attempt ${job?.attemptsMade}/${job?.opts.attempts}): ${err.message}`,
    );
  });

  return worker;
};
