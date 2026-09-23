import { Request, Response, NextFunction } from "express";
import { isQueueEnabled } from "./connection";
import { emailQueue, reconcilePaymentsQueue } from "./queues";

// Lightweight read-only visibility into the two queues for the super-admin
// console — job counts + the most recent failures, so a stuck email or a
// reconciliation error is easy to spot without needing a full dashboard.
// (bull-board is on the dependency list for a fuller UI later, but its
// current major version has sub-path-hosting quirks not worth taking on for
// v1 — see queue/README.md.)
export const getQueueStatus = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!isQueueEnabled() || !emailQueue || !reconcilePaymentsQueue) {
      return res.status(200).json({
        message: "Queues disabled",
        data: { enabled: false },
      });
    }

    const [emailCounts, emailFailed, reconcileCounts, reconcileFailed] =
      await Promise.all([
        emailQueue.getJobCounts(),
        emailQueue.getFailed(0, 9),
        reconcilePaymentsQueue.getJobCounts(),
        reconcilePaymentsQueue.getFailed(0, 9),
      ]);

    return res.status(200).json({
      message: "Queue status",
      data: {
        enabled: true,
        email: {
          counts: emailCounts,
          recentFailures: emailFailed.map((j) => ({
            id: j.id,
            data: j.data,
            failedReason: j.failedReason,
            attemptsMade: j.attemptsMade,
          })),
        },
        reconcilePayments: {
          counts: reconcileCounts,
          recentFailures: reconcileFailed.map((j) => ({
            id: j.id,
            failedReason: j.failedReason,
            attemptsMade: j.attemptsMade,
          })),
        },
      },
    });
  } catch (error) {
    return next(error);
  }
};
