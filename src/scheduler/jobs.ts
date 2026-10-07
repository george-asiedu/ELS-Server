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
      "Emails customers about appointments roughly 24 hours away. Each booking gets this reminder at most once.",
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
      "Emails customers about appointments starting in the next 30–90 minutes. Each booking gets this reminder at most once.",
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
