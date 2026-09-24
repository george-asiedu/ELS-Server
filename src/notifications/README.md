# Notifications

Every transactional/lifecycle email Zuri Studios sends goes through this
module. There is no other code path that calls `sendEmailNow`/`emailQueue`
with a hand-rolled subject/HTML string — `notifications/registry.ts` is a
complete, accurate inventory of every email the app can send.

## Why this isn't built on Plunk's own templates

The original spec assumed Plunk-hosted templates rendered with Liquid
(`{% if %}` / `{% for %}`). Verified against Plunk's actual API (`/v1/send`,
`useplunk/plunk` docs): templates only support flat `{{variable}}`
substitution with a `??` fallback — no conditionals, no loops. That can't
express payment-status branching, item loops, or optional balance-due lines.

So the architecture is:
- **Full HTML rendering lives in Node** (`design/shell.ts` + `templates/*.ts`)
  — a proper composable design system (shell + reusable components), not a
  switch statement of HTML strings.
- **Plunk is delivery-only**, called with raw `{to, subject, body, from}` via
  `sendEmailNow` (`src/email/emailService.ts`). No Plunk dashboard templates
  or template IDs are used.

## Architecture

```
notifications/
  types.ts        EmailBrand (studio | zuri), MoneyLine, branding shapes
  format.ts        ghs() — pre-format currency; the shell can't do math
  registry.ts       NotificationTemplate — the only valid `template` values
  notificationService.ts   NotificationService.send() — the single entry point
  design/shell.ts   renderShell + button/statusBadge/moneyTable/itemsTable/
                     appointmentCard — the reusable design system
  templates/*.ts    one function per email; each returns { subject, html }
```

Each service (`AppointmentService`, `PaymentService`, `OrderService`, ...)
extends `Connection`, builds an `EmailBrand` via `currentStudioBranding()`,
picks a template function, and calls:

```ts
await this.notifications.send({
  template: NotificationTemplate.BOOKING_COMPLETED,
  to: customerEmail,
  subject, html,
  studioId,        // for the log + audit trail; null for platform-level mail
  entityType: "Appointment",
  entityId: appointment.id,   // the REAL id of the thing this email is about
});
```

`NotificationService.send()` never throws — a notification failure can never
break the caller's booking/payment/order transaction. It logs to
`NotificationLog` and never re-sends the same (template, entityId, recipient)
triple twice (see Idempotency below).

Authentication records a random browser/device ID. The first recognized
device is registered silently; each later device gets one `AUTH_LOGIN_ALERT`
email. Repeat logins from the same browser do not resend the alert. The email
includes the reported browser, IP address, and UTC sign-in time. API clients
without the device header use a user-agent/IP fingerprint and may alert again
if their IP changes.

## Studio branding, and the super-admin context gotcha

`currentStudioBranding()` / `currentStudioNotifyEmail()`
(`src/db/dbConnection.ts`) resolve branding from the **ambient tenant
context** by default (`getTenantContext()?.studioId`). That's correct for
any notification sent inside a normal per-request call.

Background sweeps (the payment reconciliation cron, the billing-reminder
cron) run inside `runAsSuperAdmin(...)`, where the tenant extension bypasses
scoping entirely (see `src/tenant/tenantExtension.ts`) — there is no ambient
studioId. Those call sites **must** pass the row's own `studioId` explicitly:

```ts
await this.currentStudioBranding(payment.studioId);
```

Both helpers accept an optional override for exactly this reason. Passing it
is safe in the normal (non-super-admin) case too, since it's always the
caller's own ambient studioId there anyway.

## Idempotency

`NotificationLog` has `@@unique([template, entityId, recipient])`. Before
sending, `NotificationService.send()` checks for an existing row on that key
and no-ops if found — so a webhook retry, a cron re-run, or a duplicate
mutation can never double-email for the same business event. Choose
`entityId` to be the actual, stable id of the event:
- A one-time domain row's id (`Payment.id`, `Order.id`, `Appointment.id`).
- A composite key when one row can trigger the same template more than once
  in ways that ARE distinct events, e.g. `${userId}:${hashedResetToken}` for
  password-changed, or `${studioId}:expiring:${periodEndDateISO}` for a
  billing reminder (so a new period gets a new reminder).

## What's deliberately not implemented

The 54-section spec covers far more than this app's current data model
supports. Per its own repeated instruction — never invent data the app
doesn't have — the following were scoped out (see the comment block at the
top of `registry.ts` for the live list, which is the source of truth):

- **AUTH_VERIFY_EMAIL** — no email-verification flow exists.
- **BOOKING_RESCHEDULED** — no reschedule flow exists.
- **BOOKING_REMINDER_24H / _1H** — would need a new scheduled sweep over
  upcoming appointments. Real, plausible follow-up work; not built yet.
- **REFUND_SUCCESS / PARTIAL_REFUND** — no refund model/flow exists.
- **SHOP_ORDER_SHIPPED** / tracking numbers — no shipping/tracking model;
  fulfilment is PICKUP/DELIVERY only (see `SHOP_ORDER_FULFILLED`).
- **STUDIO_ONBOARDING_COMPLETED checklist** — "setup completeness" isn't
  modeled anywhere.
- **STUDIO_SETTLEMENT_SUCCESS/FAILED** — doesn't apply architecturally:
  Paystack subaccounts settle directly to each studio's own account: the
  platform never holds or transfers a studio's money, so there's no
  settlement event to report.

## Adding a new template

1. Add a key to `NotificationTemplate` in `registry.ts`.
2. Write a function in `templates/*.ts` (new file per category, or add to an
   existing one) that takes `(brand: EmailBrand, data)` and returns
   `{ subject, html }`, built from `design/shell.ts` components. Don't invent
   new inline HTML/styles outside the shell unless a component doesn't exist
   yet for what you need — add the component to `shell.ts` instead so it's
   reusable.
3. Call `this.notifications.send({ template, to, subject, html, studioId,
   entityType, entityId })` from the service that owns the triggering event,
   wrapped in try/catch (or let `send()`'s own internal catch handle it — it
   never throws) so a notification failure never blocks the caller's
   transaction.
4. If the call site can run inside `runAsSuperAdmin` (a cron sweep), pass the
   row's own `studioId` explicitly to `currentStudioBranding()` /
   `currentStudioNotifyEmail()` — see the gotcha above.

No existing template, registry entry, or service needs to change to add a
new one.
