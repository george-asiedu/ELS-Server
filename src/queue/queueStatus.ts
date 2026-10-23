import { Request, Response } from "express";
import { isQueueEnabled } from "./connection";
import { emailQueue } from "./queues";

// Read-only view of the email queue for the platform console: job counts and
// the most recent failures, so a stuck email is easy to spot. Each call costs
// a handful of Redis commands, so the console fetches it on demand rather
// than on a tight poll.
export const getQueueStatus = async (_req: Request, res: Response) => {
  if (!isQueueEnabled() || !emailQueue) {
    return res
      .status(200)
      .json({ message: "Queues disabled", data: { enabled: false } });
  }

  const [counts, failed] = await Promise.all([
    emailQueue.getJobCounts(),
    emailQueue.getFailed(0, 9),
  ]);

  return res.status(200).json({
    message: "Queue status",
    data: {
      enabled: true,
      email: {
        counts,
        recentFailures: failed.map((j) => ({
          id: j.id,
          data: { to: j.data.to, subject: j.data.subject },
          failedReason: j.failedReason,
          attemptsMade: j.attemptsMade,
        })),
      },
    },
  });
};
