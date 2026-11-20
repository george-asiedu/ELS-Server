// The recurring jobs the platform runs, and when. Times are UTC (Ghana's
// local time). Services are constructed inside `run` so importing the
// registry (for the console's job list) doesn't build every service.

export interface JobSchedule {
  // A run is due once per period; `offsetMinutes` shifts where in the period it
  // falls (e.g. hourly at :05, daily at 08:00).
  periodMinutes: number;
  offsetMinutes: number;
}

export interface JobDefinition {
  key: string;
  label: string;
  description: string;
  schedule: JobSchedule;
  scheduleLabel: string;
  // Longest a run may hold its lease. A run still going past this is assumed
  // dead (crashed process) and the next slot may start.
  maxRunMinutes: number;
  run: () => Promise<Record<string, unknown>>;
}

export const JOBS: JobDefinition[] = [
  {
    key: "reconcile-payments",
    label: "Payment reconciliation",
    description:
      "Re-checks payments and shop orders still pending after 15 minutes with Paystack, and closes out ones abandoned for 3 days. Catches payments whose webhook never arrived.",
    schedule: { periodMinutes: 15, offsetMinutes: 0 },
    scheduleLabel: "Every 15 minutes",
    maxRunMinutes: 10,
    run: async () => {
      const { PaymentService } = await import("../payment/paymentService");
      return { ...(await new PaymentService().reconcilePendingPayments()) };
    },
  },
  {
    key: "booking-reminders-24h",
    label: "Day-before reminders",
    description:
      "Reminds customers (by push, else email) and the studio's admins (by push) about appointments roughly 24 hours away. Each booking gets this reminder at most once.",
    schedule: { periodMinutes: 60, offsetMinutes: 5 },
    scheduleLabel: "Hourly, at 5 past",
    maxRunMinutes: 10,
    run: async () => {
      const { AppointmentService } =
        await import("../appointment/appointmentService");
      return { ...(await new AppointmentService().sendDueReminders("24H")) };
    },
  },
  {
    key: "booking-reminders-1h",
    label: "Hour-before reminders",
    description:
      "Reminds customers (by push, else email) and the studio's admins (by push) about appointments starting in the next 30–90 minutes. Each booking gets this reminder at most once.",
    schedule: { periodMinutes: 15, offsetMinutes: 0 },
    scheduleLabel: "Every 15 minutes",
    maxRunMinutes: 10,
    run: async () => {
      const { AppointmentService } =
        await import("../appointment/appointmentService");
      return { ...(await new AppointmentService().sendDueReminders("1H")) };
    },
  },
  {
    key: "review-requests",
    label: "Review requests",
    description:
      "Asks customers for a review (email and push) a day after a completed visit and a few days after an order was handed over. Each is asked once.",
    schedule: { periodMinutes: 24 * 60, offsetMinutes: 10 * 60 },
    scheduleLabel: "Daily at 10:00 UTC",
    maxRunMinutes: 20,
    run: async () => {
      const { ReviewRequestService } = await import("../reviews/reviewRequests");
      return { ...(await new ReviewRequestService().sendDue()) };
    },
  },
  {
    key: "monthly-reports",
    label: "Monthly reports",
    description:
      "Emails each studio's and store's admins last month's figures, with a push saying it's in their inbox. Runs daily; each studio gets each month's report once.",
    schedule: { periodMinutes: 24 * 60, offsetMinutes: 7 * 60 },
    scheduleLabel: "Daily at 07:00 UTC",
    maxRunMinutes: 30,
    run: async () => {
      const { MonthlyReportService } = await import("../reports/monthlyReport");
      return { ...(await new MonthlyReportService().sendDue()) };
    },
  },
  {
    key: "storage-maintenance",
    label: "Storage",
    description:
      "Empties gallery trash items older than 30 days, and on the 1st adds each studio's extra storage for the new month to its next bill.",
    schedule: { periodMinutes: 24 * 60, offsetMinutes: 3 * 60 },
    scheduleLabel: "Daily at 03:00 UTC",
    maxRunMinutes: 30,
    run: async () => {
      const { GalleryService } = await import("../gallery/galleryService");
      const { S3BucketService } = await import("../bucket/s3BucketService");
      const { billStorageForMonth } = await import("../storage/storageService");
      const purged = await new GalleryService(new S3BucketService()).purgeExpired();
      // Extra storage is added for the month once; re-running it is harmless.
      const billed = await billStorageForMonth();
      return { ...purged, ...billed };
    },
  },
  {
    key: "billing-reminders",
    label: "Subscription reminders",
    description:
      "Warns studios whose plan ends within 3 days, and tells studios whose plan has lapsed.",
    schedule: { periodMinutes: 24 * 60, offsetMinutes: 8 * 60 },
    scheduleLabel: "Daily at 08:00",
    maxRunMinutes: 15,
    run: async () => {
      const { StudioService } = await import("../studio/studioService");
      const { S3BucketService } = await import("../bucket/s3BucketService");
      return {
        ...(await new StudioService(
          new S3BucketService(),
        ).checkBillingReminders()),
      };
    },
  },
];

export const jobByKey = (key: string) => JOBS.find((j) => j.key === key);

/** Start of the scheduled slot `at` falls in. */
export const slotStart = (schedule: JobSchedule, at: number): number => {
  const period = schedule.periodMinutes * 60_000;
  const offset = schedule.offsetMinutes * 60_000;
  return Math.floor((at - offset) / period) * period + offset;
};

export const slotId = (schedule: JobSchedule, at: number) =>
  new Date(slotStart(schedule, at)).toISOString();
