# Background work

Two mechanisms, deliberately different:

1. **Email sending** goes through a BullMQ queue in Redis (this folder), so a
   failed send is retried with backoff instead of lost.
2. **Recurring jobs** (payment reconciliation, booking reminders,
   subscription reminders) run from the database-backed scheduler in
   `src/scheduler`. They use no Redis at all, and the super admin can switch
   each one on or off, or run it now, from the platform console (Jobs).

## Email queue setup

Set `REDIS_URL` in `.env` (and on Render) to turn the queue on:

```sh
REDIS_URL=redis://default:<password>@<host>:<port>
```

Without `REDIS_URL` emails send inline, exactly as before the queue existed.
The app logs which mode it's in at boot.

## What uses Redis, and how much

Hosted Redis (Upstash and similar) bills per command, so idle traffic matters
as much as real traffic. Measured against a local Redis with no API traffic:

| Setup | Idle requests / minute | Per 30-day month |
| --- | --- | --- |
| Before: 4 BullMQ workers (email + 3 cron queues) | ~68 | ~2.9 million |
| Now: email worker only | ~2.5 | ~110 thousand |

Why it was high: a queue with a recurring schedule always holds its next run
as a delayed job, and BullMQ caps an idle worker's wait at 10 seconds while a
delayed job exists. Each cron worker therefore polled ~6 times a minute (plus a
script each time), and every worker also ran a stalled-job check every 30
seconds. The email worker now waits up to 60s between polls (a new job wakes it
immediately) and checks for stalled jobs every 5 minutes.

What still costs Redis commands, roughly:

- **Each queued email**: ~10–15 commands to add, process and complete it.
- **Rate limits on sensitive routes** (login, signup, password recovery,
  payments, orders, refunds): one command per request to those routes. The
  general per-IP API limit is kept in process memory instead, since it runs on
  every request.
- **The platform console's email-queue panel**: a few commands per refresh.

## Scheduler

See `src/scheduler/jobs.ts` for the job list and schedules (UTC) and
`src/scheduler/scheduler.ts` for how runs are claimed. Each job has a row in
`scheduled_jobs`; a run is claimed with a conditional update on that row, so
it runs once per slot even across several API instances.

The scheduler runs when `SCHEDULER_ENABLED=true`, which is the default only in
production — so a laptop pointed at a shared database doesn't start sending
reminder emails.

### Adding a recurring job

Add an entry to `JOBS` in `src/scheduler/jobs.ts` with a key, label,
description, schedule (`periodMinutes` + `offsetMinutes`) and `run` function.
Its row is created on the next boot; its first run is the next scheduled slot.

## Splitting email work into its own process

The email worker runs in the API process. If volume ever needs it, deploy a
separate Render Background Worker that calls `bootstrapQueues()` with the same
`REDIS_URL`/`DATABASE_URL`, and remove the call from `app.ts`.
