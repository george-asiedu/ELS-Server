import { Worker } from "bullmq";
import { getRedisConnection } from "../connection";
import { QUEUE_NAMES, WhatsappJobData } from "../queues";
import { deliverBookingWhatsapp } from "../../whatsapp/whatsappService";

// Sends WhatsApp messages through Meta's API, no faster than 10 a second so a
// burst of reminders never trips Meta's limits or crowds out the other queues.
export const createWhatsappWorker = (): Worker<WhatsappJobData> => {
  const worker = new Worker<WhatsappJobData>(
    QUEUE_NAMES.whatsapp,
    async (job) => {
      await deliverBookingWhatsapp(job.data);
    },
    {
      connection: getRedisConnection()!,
      concurrency: 2,
      limiter: { max: 10, duration: 1000 },
      drainDelay: 60,
      stalledInterval: 5 * 60_000,
    },
  );
  worker.on("failed", (job, err) => console.error(`WhatsApp job ${job?.id} failed: ${err.message}`));
  return worker;
};
