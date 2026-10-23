import { Prisma } from "../generated/prisma-client/client";
import { createTenantClient } from "../tenant/tenantClient";
import { runAsSuperAdmin } from "../tenant/context";
import { ApiError } from "../middleware/apiError";
import { JOBS, JobDefinition, jobByKey, slotId, slotStart } from "./jobs";

/**
 * Runs the recurring jobs in jobs.ts from inside the API process.
 *
 * Every TICK_MS each job's current slot is computed (e.g. "the 10:15 run" for
 * an every-15-minutes job). A run is claimed with one conditional UPDATE on
 * its scheduled_jobs row: the slot must not have been claimed already and no
 * lease may be live. Only the instance whose update matched runs it, so
 * several instances never double-run a slot, and nothing touches Redis.
 *
 * A slot missed entirely (process down across it) is skipped, not replayed:
 * each job scans a window wider than its period, so the next run covers it.
 */

const TICK_MS = 30_000;
const { raw } = createTenantClient();

let timer: NodeJS.Timeout | null = null;
const inFlight = new Set<Promise<void>>();

const leaseUntil = (job: JobDefinition, now: number) =>
  new Date(now + job.maxRunMinutes * 60_000);

const noLiveLease = (now: number): Prisma.ScheduledJobWhereInput => ({
  OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date(now) } }],
});

/** Create a row for any job that doesn't have one yet. */
const ensureRows = async () => {
  const now = Date.now();
  await raw.scheduledJob.createMany({
    // A new job's first run is the NEXT boundary, not "now": a daily job added
    // at 15:00 shouldn't fire immediately just because 08:00 has passed.
    data: JOBS.map((job) => ({
      key: job.key,
      lastSlot: slotId(job.schedule, now),
    })),
    skipDuplicates: true,
  });
};

const execute = async (job: JobDefinition) => {
  const started = Date.now();
  try {
    const result = await runAsSuperAdmin(() => job.run());
    await raw.scheduledJob.update({
      where: { key: job.key },
      data: {
        lastStatus: "SUCCESS",
        lastFinishedAt: new Date(),
        lastDurationMs: Date.now() - started,
        lastResult: result as Prisma.InputJsonValue,
        lastError: null,
        lockedUntil: null,
        runCount: { increment: 1 },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Scheduled job ${job.key} failed:`, message);
    await raw.scheduledJob
      .update({
        where: { key: job.key },
        data: {
          lastStatus: "FAILED",
          lastFinishedAt: new Date(),
          lastDurationMs: Date.now() - started,
          lastError: message.slice(0, 2000),
          lockedUntil: null,
          runCount: { increment: 1 },
          failureCount: { increment: 1 },
        },
      })
      .catch((e) => console.error(`Could not record ${job.key} failure:`, e));
  }
};

const track = (p: Promise<void>) => {
  inFlight.add(p);
  void p.finally(() => inFlight.delete(p));
};

const tick = async () => {
  const now = Date.now();
  for (const job of JOBS) {
    const slot = slotId(job.schedule, now);
    try {
      const claimed = await raw.scheduledJob.updateMany({
        where: {
          key: job.key,
          enabled: true,
          OR: [{ lastSlot: null }, { lastSlot: { not: slot } }],
          AND: [noLiveLease(now)],
        },
        data: {
          lastSlot: slot,
          lockedUntil: leaseUntil(job, now),
          lastStartedAt: new Date(now),
          lastStatus: "RUNNING",
          lastTrigger: "schedule",
        },
      });
      if (claimed.count === 1) track(execute(job));
    } catch (error) {
      console.error(`Scheduler could not check ${job.key}:`, error);
    }
  }
};

export const startScheduler = async () => {
  if (timer) return;
  await ensureRows();
  await tick();
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();
  console.log(
    `Scheduler running ${JOBS.length} jobs (checks every ${TICK_MS / 1000}s).`,
  );
};

/** Stop claiming new runs and wait (up to `timeoutMs`) for running ones. */
export const stopScheduler = async (timeoutMs = 20_000) => {
  if (timer) clearInterval(timer);
  timer = null;
  if (!inFlight.size) return;
  await Promise.race([
    Promise.allSettled([...inFlight]),
    new Promise((resolve) => setTimeout(resolve, timeoutMs).unref()),
  ]);
};

// ---- Console operations ----------------------------------------------------

const toView = (
  job: JobDefinition,
  row:
    | Awaited<ReturnType<typeof raw.scheduledJob.findMany>>[number]
    | undefined,
  now: number,
) => {
  const current = slotStart(job.schedule, now);
  const period = job.schedule.periodMinutes * 60_000;
  const leaseLive = !!row?.lockedUntil && row.lockedUntil.getTime() > now;
  const enabled = row?.enabled ?? true;
  // The next run is this slot if it hasn't been claimed yet, else the next one.
  const nextRunAt = !enabled
    ? null
    : row?.lastSlot === new Date(current).toISOString()
      ? new Date(current + period)
      : new Date(current);
  return {
    key: job.key,
    label: job.label,
    description: job.description,
    schedule: job.scheduleLabel,
    enabled,
    running: row?.lastStatus === "RUNNING" && leaseLive,
    // RUNNING with an expired lease: the process died mid-run.
    interrupted: row?.lastStatus === "RUNNING" && !leaseLive,
    nextRunAt,
    lastStartedAt: row?.lastStartedAt ?? null,
    lastFinishedAt: row?.lastFinishedAt ?? null,
    lastStatus: row?.lastStatus ?? null,
    lastTrigger: row?.lastTrigger ?? null,
    lastResult: row?.lastResult ?? null,
    lastError: row?.lastError ?? null,
    lastDurationMs: row?.lastDurationMs ?? null,
    runCount: row?.runCount ?? 0,
    failureCount: row?.failureCount ?? 0,
    updatedBy: row?.updatedBy ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
};

export type ScheduledJobView = ReturnType<typeof toView>;

export const listJobs = async () => {
  await ensureRows();
  const rows = await raw.scheduledJob.findMany();
  const now = Date.now();
  return JOBS.map((job) =>
    toView(
      job,
      rows.find((r) => r.key === job.key),
      now,
    ),
  );
};

const getJob = async (key: string) => {
  const job = jobByKey(key);
  if (!job) throw new ApiError("Unknown job", 404);
  await ensureRows();
  return job;
};

export const setJobEnabled = async (
  key: string,
  enabled: boolean,
  actorEmail: string,
) => {
  const job = await getJob(key);
  await raw.scheduledJob.update({
    where: { key },
    data: { enabled, updatedBy: actorEmail },
  });
  const row = await raw.scheduledJob.findUnique({ where: { key } });
  return toView(job, row ?? undefined, Date.now());
};

/**
 * Start a run now, whether or not the job is switched on (an operator may
 * want one sweep without re-enabling the schedule). Returns once the run is
 * claimed; the run itself continues in the background.
 */
export const runJobNow = async (key: string, actorEmail: string) => {
  const job = await getJob(key);
  const now = Date.now();
  const claimed = await raw.scheduledJob.updateMany({
    where: { key, ...noLiveLease(now) },
    data: {
      lockedUntil: leaseUntil(job, now),
      lastStartedAt: new Date(now),
      lastStatus: "RUNNING",
      lastTrigger: `manual:${actorEmail}`,
    },
  });
  if (claimed.count === 0) {
    throw new ApiError("That job is already running", 409);
  }
  track(execute(job));
  const row = await raw.scheduledJob.findUnique({ where: { key } });
  return toView(job, row ?? undefined, now);
};
