import webpush from "web-push";
import { env } from "../config/env.config";
import { createTenantClient } from "../tenant/tenantClient";
import type { NotificationTemplateKey } from "../notifications/registry";

// Web push to the browsers and installed apps people have switched on, as in
// the Westend City Church app. Every push mirrors an email the app already
// sends (see pushForNotification), so nothing is ever push-only.

const { raw } = createTenantClient();

export const pushConfigured = Boolean(
  env.vapid.publicKey && env.vapid.privateKey,
);
if (pushConfigured)
  webpush.setVapidDetails(
    env.vapid.subject,
    env.vapid.publicKey,
    env.vapid.privateKey,
  );

export interface PushPayload {
  title: string;
  body: string;
  /** A path on the studio's (or platform's) own site; tapping opens it. */
  url: string;
  /** Same tag replaces the earlier notification instead of stacking. */
  tag?: string;
}

const CONCURRENCY = 20;

/** Sends to every device of each user. Dead subscriptions are removed. */
export const pushToUsers = async (userIds: string[], payload: PushPayload) => {
  const result = { sent: 0, failed: 0, removed: 0 };
  if (!pushConfigured || !userIds.length) return result;
  const subs = await raw.pushSubscription.findMany({
    where: { userId: { in: [...new Set(userIds)] } },
  });
  const body = JSON.stringify(payload);
  const ok: string[] = [];
  const dead: string[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, subs.length) }, async () => {
      while (next < subs.length) {
        const s = subs[next++]!;
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body,
            { TTL: 6 * 3600, urgency: "normal", topic: payload.tag?.slice(0, 32) },
          );
          ok.push(s.id);
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) dead.push(s.id);
          else {
            result.failed++;
            console.warn("Push failed:", status, (e as Error).message);
          }
        }
      }
    }),
  );
  result.sent = ok.length;
  result.removed = dead.length;
  await Promise.all([
    ok.length
      ? raw.pushSubscription.updateMany({
          where: { id: { in: ok } },
          data: { lastSuccessAt: new Date() },
        })
      : null,
    dead.length
      ? raw.pushSubscription.deleteMany({ where: { id: { in: dead } } })
      : null,
  ]).catch((e) => console.warn("Push bookkeeping failed:", (e as Error).message));
  return result;
};

// Which emails also go out as a push, and where tapping it lands. Sign-in and
// password emails stay email-only.
const PUSH_ROUTES: Partial<Record<NotificationTemplateKey, string>> = {
  BOOKING_REQUEST_STUDIO: "/admin/appointments?status=pending",
  BOOKING_RESCHEDULE_REQUESTED: "/admin/appointments?status=pending_reschedule",
  BOOKING_REQUEST_CUSTOMER: "/account?tab=appointments",
  BOOKING_CONFIRMED: "/account?tab=appointments",
  BOOKING_RESCHEDULED: "/account?tab=appointments",
  BOOKING_SERVICE_CHANGED: "/account?tab=appointments",
  BOOKING_CANCELLED: "/account?tab=appointments",
  BOOKING_COMPLETED: "/account?tab=appointments",
  BOOKING_REMINDER_24H: "/account?tab=appointments",
  BOOKING_REMINDER_1H: "/account?tab=appointments",
  PAYMENT_SUCCESS: "/account?tab=transactions",
  PAYMENT_FAILED: "/account?tab=transactions",
  REFUND_PROCESSED: "/account?tab=transactions",
  SHOP_ORDER_CONFIRMED: "/account?tab=orders",
  SHOP_ORDER_PAYMENT_FAILED: "/account?tab=orders",
  SHOP_ORDER_FULFILLED: "/account?tab=orders",
  SHOP_ORDER_STAGE: "/account?tab=orders",
  SUBSCRIPTION_EXPIRING_SOON: "/admin/billing",
  SUBSCRIPTION_EXPIRED: "/admin/billing",
  FEATURE_REQUEST_STATUS_STUDIO: "/admin/feature-requests",
  FEATURE_REQUEST_SUBMITTED_PLATFORM: "/platform",
  STUDIO_MONTHLY_REPORT: "/admin/analytics",
  REFUNDED_BY_STUDIO: "/account",
  REVIEW_REQUEST: "/account",
  WAITLIST_SLOT_OPEN: "/book",
  VOUCHER_DELIVERED: "/account",
};

/**
 * Tell people something: a row in their in-app notifications list, plus a
 * push to every device they've switched on. Returns how many devices got it.
 */
export const notifyUsers = async (userIds: string[], payload: PushPayload) => {
  const ids = [...new Set(userIds)];
  if (!ids.length) return 0;
  await raw.notification.createMany({
    data: ids.map((userId) => ({
      userId,
      title: payload.title.slice(0, 120),
      body: payload.body.slice(0, 400),
      url: payload.url.slice(0, 300),
    })),
  });
  const { sent } = await pushToUsers(ids, payload);
  return sent;
};

/**
 * The in-app and push twin of an email: the people with that email address
 * (in that studio, or platform accounts) get the subject as a notification.
 * Returns how many devices got the push. Never throws: a problem here must
 * not affect the email or the event.
 */
export const pushForNotification = async (args: {
  template: NotificationTemplateKey;
  to: string;
  subject: string;
  studioId?: string | null;
  entityId: string;
  pushBody?: string;
  pushUrl?: string;
}): Promise<number> => {
  const url = args.pushUrl ?? PUSH_ROUTES[args.template];
  if (!url) return 0;
  try {
    const users = await raw.user.findMany({
      where: {
        email: { equals: args.to, mode: "insensitive" },
        // A studio's email reaches that studio's accounts; a platform email
        // (no studio) reaches the super admins.
        ...(args.studioId ? { studioId: args.studioId } : { studioId: null }),
      },
      select: { id: true },
    });
    if (!users.length) return 0;
    const studio = args.studioId
      ? await raw.studio.findUnique({
          where: { id: args.studioId },
          select: { name: true },
        })
      : null;
    return await notifyUsers(
      users.map((u) => u.id),
      {
        title: studio?.name ?? "Zuri Studios",
        body: args.pushBody ?? args.subject,
        url,
        tag: `${args.template}:${args.entityId}`,
      },
    );
  } catch (e) {
    console.warn(`Notice for ${args.template} failed:`, (e as Error).message);
    return 0;
  }
};

/** Reminders: a push when the person has a device on, else the email. */
export const PUSH_FIRST = new Set<NotificationTemplateKey>([
  "BOOKING_REMINDER_24H",
  "BOOKING_REMINDER_1H",
  "SUBSCRIPTION_EXPIRING_SOON",
]);

/**
 * A notice (in-app and push) to every admin of a studio, sent once per `key`:
 * the notification log's unique key stops a repeat.
 */
export const notifyStudioAdmins = async (
  studioId: string,
  key: { template: string; entityId: string; entityType?: string },
  payload: PushPayload,
) => {
  const admins = await raw.user.findMany({
    where: { studioId, role: "ADMIN" },
    select: { id: true },
  });
  if (!admins.length) return 0;
  try {
    await raw.notificationLog.create({
      data: {
        studioId,
        template: key.template,
        recipient: `admins:${studioId}`,
        entityType: key.entityType ?? "Appointment",
        entityId: key.entityId,
        status: "PUSHED",
        sentAt: new Date(),
      },
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return 0; // already sent
    throw e;
  }
  return notifyUsers(
    admins.map((a) => a.id),
    payload,
  );
};
