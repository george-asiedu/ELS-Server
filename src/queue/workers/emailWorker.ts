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
      // An idle worker long-polls Redis for new jobs, and every poll is a
      // billed command on hosted Redis. Adding a job wakes the poll at once,
      // so waiting longer between polls costs nothing in delivery speed —
      // it only cuts idle traffic (the default is 5s).
      drainDelay: 60,
      // How often to look for jobs whose worker died mid-send. Five minutes
      // instead of the default 30s: a crashed send is retried a little later,
      // and the idle worker makes a tenth of the requests.
      stalledInterval: 5 * 60_000,
    },
  );

  worker.on("failed", (job, err) => {
    console.error(
      `Email job ${job?.id} failed (attempt ${job?.attemptsMade}/${job?.opts.attempts}): ${err.message}`,
    );
  });

  return worker;
};
