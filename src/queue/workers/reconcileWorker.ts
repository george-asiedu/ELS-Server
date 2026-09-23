import { Worker } from "bullmq";
import { getRedisConnection } from "../connection";
import { QUEUE_NAMES, ReconcilePaymentsJobData } from "../queues";
import { PaymentService } from "../../payment/paymentService";

// Runs the payment/order reconciliation sweep (see
// PaymentService.reconcilePendingPayments) whenever the repeatable job fires.
export const createReconcileWorker = (): Worker<ReconcilePaymentsJobData> => {
  const connection = getRedisConnection();
  if (!connection) {
    throw new Error("createReconcileWorker called without a Redis connection");
  }

  const paymentService = new PaymentService();

  const worker = new Worker<ReconcilePaymentsJobData>(
    QUEUE_NAMES.reconcilePayments,
    async () => {
      const result = await paymentService.reconcilePendingPayments();
      if (result.checked > 0 || result.expired > 0) {
        console.log("Payment reconciliation:", result);
      }
      return result;
    },
    {
      connection,
      concurrency: 1, // never run two sweeps at once
    },
  );

  worker.on("failed", (job, err) => {
    console.error(`Reconciliation job ${job?.id} failed: ${err.message}`);
  });

  return worker;
};
