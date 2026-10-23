import type { Worker } from "bullmq";
import { Queue } from "bullmq";
import { isQueueEnabled, getRedisConnection } from "./connection";
import { emailQueue, LEGACY_QUEUE_NAMES, QUEUE_NAMES } from "./queues";
import { createEmailWorker } from "./workers/emailWorker";

const workers: Worker[] = [];

/**
 * The recurring jobs used to live in three BullMQ queues. Each kept a delayed
 * "next run" job, which caps an idle worker's wait at 10 seconds, so those
 * three workers alone polled Redis ~36 times a minute around the clock. They
 * now run from the database-backed scheduler; this removes the old queues'
 * keys (and their schedules) the first time it finds them. A no-op once done,
 * at one EXISTS per queue per boot.
 */
const retireLegacyQueues = async () => {
  const connection = getRedisConnection()!;
  for (const name of LEGACY_QUEUE_NAMES) {
    if (!(await connection.exists(`bull:${name}:meta`))) continue;
    const queue = new Queue(name, { connection });
    try {
      await queue.obliterate({ force: true });
      console.log(`Removed legacy queue "${name}" (now run by the scheduler).`);
    } catch (error) {
      console.error(`Could not remove legacy queue "${name}":`, error);
    } finally {
      await queue.close();
    }
  }
};

// Call once at boot (see app.ts). No-ops entirely when REDIS_URL isn't set —
// emails then send inline (see queue/README.md).
export const bootstrapQueues = async (): Promise<void> => {
  if (!isQueueEnabled()) {
    console.log(
      "REDIS_URL not set — email queue disabled: emails send inline. See src/queue/README.md.",
    );
    return;
  }

  // Verify Redis is actually reachable before wiring up the worker, so a bad
  // REDIS_URL fails loudly at boot instead of silently dropping every job.
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

  await retireLegacyQueues();
  workers.push(createEmailWorker());
  console.log(`Queue online: "${QUEUE_NAMES.email}" (background email).`);
};

/**
 * Stop taking jobs and let the ones in flight finish (Worker.close waits for
 * them), then release the queue and the shared Redis connection. Called on
 * SIGTERM so a deploy doesn't kill an email send halfway.
 */
export const shutdownQueues = async (): Promise<void> => {
  await Promise.allSettled(workers.map((w) => w.close()));
  await emailQueue?.close().catch(() => undefined);
  await getRedisConnection()
    ?.quit()
    .catch(() => undefined);
};
