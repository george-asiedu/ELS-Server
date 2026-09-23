# Background jobs (BullMQ + Redis)

Two things run through here:

1. **Email sending** — every transactional email (booking confirmations, payment
   receipts, order receipts, password resets) is queued instead of sent inline,
   with automatic retries.
2. **Payment reconciliation** — a job that runs every 15 minutes and catches
   Paystack payments/orders that never got a final status because a webhook was
   lost or the customer closed the tab before the client-side verify ran.

## Setup

Set `REDIS_URL` in `.env` (and on Render) to turn this on:

```
REDIS_URL=redis://default:<password>@<host>:<port>
```

Free options that work fine at this scale:
- **Upstash** (upstash.com) — serverless Redis, generous free tier, gives you a
  `rediss://...` URL directly.
- **Render Key Value** — a managed Redis instance in the same region as the web
  service (lowest latency); add it from the Render dashboard and copy its
  internal connection string.

**Nothing is required to keep working without Redis.** If `REDIS_URL` is unset:
- Emails send synchronously inline, exactly like before this existed.
- The reconciliation sweep simply doesn't run (the webhook + client-side verify
  are still the primary paths — this is a safety net, not the only path to a
  correct payment status).

The app logs which mode it's in at boot.

## How it's wired

- `connection.ts` — the shared ioredis connection, built lazily from `REDIS_URL`.
- `queues.ts` — the two `Queue` instances (`email`, `reconcile-payments`), each
  `null` when Redis isn't configured.
- `workers/emailWorker.ts` / `workers/reconcileWorker.ts` — the job processors.
- `index.ts` (`bootstrapQueues`) — called once from `app.ts` at boot: pings
  Redis, starts both workers, and schedules the reconciliation job
  (`upsertJobScheduler`, idempotent — safe to call on every deploy).
- `queueStatus.ts` — read-only status for the super-admin console
  (`GET /api/platform/queues`): job counts + the last few failures for each
  queue, so a stuck email or a reconciliation error is visible without a full
  dashboard.

Both queues currently run **in the same Node process as the API** — simplest
option, and plenty for this scale (a handful of emails per booking/order, one
sweep every 15 minutes). If email volume or the sweep ever needs to scale
independently of the API, split it out:

```jsonc
// package.json
"worker": "ts-node src/queue/startStandalone.ts"
```

```ts
// src/queue/startStandalone.ts (not created yet — add when needed)
import { bootstrapQueues } from "./index";
bootstrapQueues();
```

...and deploy that as a separate Render **Background Worker** service pointed
at the same `REDIS_URL` and `DATABASE_URL`. Remove the `bootstrapQueues()` call
from `app.ts` at that point so jobs aren't processed in two places.

## Full dashboard (optional, not wired up)

`bull-board` is already a dependency but isn't mounted — its current major
version (v2) is deprecated and has known quirks hosting its router on a
sub-path (like `/api/platform/queues`) behind a reverse proxy, which wasn't
worth the risk for a first cut. The lightweight JSON status endpoint covers the
"is something stuck?" question. If a full retry/inspect UI is wanted later,
migrate to the maintained `@bull-board/express` + `@bull-board/api` packages
instead of the installed `bull-board`.

## Adding a new background job

1. Add a `Queue<YourJobData>` in `queues.ts` (guarded by `isQueueEnabled()`,
   same pattern as the two existing ones).
2. Add a `workers/yourWorker.ts` that processes it.
3. Start the worker in `bootstrapQueues()`.
4. For a recurring job, call `queue.upsertJobScheduler(id, { pattern: cron },
   { name, data })` — cron syntax, e.g. `"0 3 * * *"` for daily at 3am.
