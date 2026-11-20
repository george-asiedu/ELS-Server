import { Worker } from "bullmq";
import { getRedisConnection } from "../connection";
import { PushJobData, QUEUE_NAMES } from "../queues";
import { pushToUsers } from "../../push/pushService";

// Sends queued push notifications. Four at a time is plenty: each job fans out
// to a person's devices itself.
export const createPushWorker = (): Worker<PushJobData> => {
  const worker = new Worker<PushJobData>(
    QUEUE_NAMES.push,
    async (job) => {
      await pushToUsers(job.data.userIds, job.data.payload);
    },
    {
      connection: getRedisConnection()!,
      concurrency: 4,
      drainDelay: 60,
      stalledInterval: 5 * 60_000,
    },
  );
  worker.on("failed", (job, err) => console.error(`Push job ${job?.id} failed: ${err.message}`));
  return worker;
};
