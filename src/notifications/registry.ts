// Centralized notification template registry (Section 36 naming from the
// design spec). Every notification the app sends is named here — nothing
// calls emailQueue/sendEmailNow directly with a hand-rolled subject/HTML
// string outside notifications/templates/*, so this list is a complete,
// accurate inventory of every email Zuri Studios sends.
//
// Deliberately NOT implemented (see notifications/README.md for why each one
// doesn't apply to this app's actual architecture today):
//   AUTH_VERIFY_EMAIL                     — no email-verification flow exists.
//   (Reschedule, reminders and refunds now exist — see the entries below.)
//   SHOP_ORDER_SHIPPED / tracking numbers — no shipping/tracking model exists
//     (fulfilment is PICKUP/DELIVERY only) — see SHOP_ORDER_FULFILLED instead.
//   STUDIO_ONBOARDING_COMPLETED checklist — "setup completeness" isn't modeled.
//   STUDIO_SETTLEMENT_SUCCESS/FAILED      — STRUCK FROM THE SPEC, permanently.
//     Paystack subaccounts settle directly to the studio's own bank account;
//     the platform never holds, batches or transfers a studio's money, so
//     there is no settlement event to report and no settlement document to
//     issue. Revisit only if payouts ever move through a platform balance.
export const NotificationTemplate = {
  AUTH_PASSWORD_RESET_REQUESTED: "AUTH_PASSWORD_RESET_REQUESTED",
  AUTH_PASSWORD_CHANGED: "AUTH_PASSWORD_CHANGED",
  AUTH_LOGIN_ALERT: "AUTH_LOGIN_ALERT",
  CUSTOMER_WELCOME: "CUSTOMER_WELCOME",

  STUDIO_CREATED: "STUDIO_CREATED",
  STUDIO_ACCOUNT_SUSPENDED: "STUDIO_ACCOUNT_SUSPENDED",

  BOOKING_REQUEST_CUSTOMER: "BOOKING_REQUEST_CUSTOMER",
  BOOKING_REQUEST_STUDIO: "BOOKING_REQUEST_STUDIO",
  BOOKING_COMPLETED: "BOOKING_COMPLETED",
  BOOKING_CANCELLED: "BOOKING_CANCELLED",

  PAYMENT_SUCCESS: "PAYMENT_SUCCESS",
  PAYMENT_FAILED: "PAYMENT_FAILED",

  SHOP_ORDER_CONFIRMED: "SHOP_ORDER_CONFIRMED",
  SHOP_ORDER_PAYMENT_FAILED: "SHOP_ORDER_PAYMENT_FAILED",
  SHOP_ORDER_FULFILLED: "SHOP_ORDER_FULFILLED",

  SUBSCRIPTION_EXPIRING_SOON: "SUBSCRIPTION_EXPIRING_SOON",
  SUBSCRIPTION_EXPIRED: "SUBSCRIPTION_EXPIRED",

  // A studio asked the platform for a feature; and the studio being told how
  // that request is progressing.
  FEATURE_REQUEST_SUBMITTED_PLATFORM: "FEATURE_REQUEST_SUBMITTED_PLATFORM",
  FEATURE_REQUEST_STATUS_STUDIO: "FEATURE_REQUEST_STATUS_STUDIO",

  REFUND_PROCESSED: "REFUND_PROCESSED",
  REFUND_FAILED: "REFUND_FAILED",

  BOOKING_CONFIRMED: "BOOKING_CONFIRMED",
  BOOKING_RESCHEDULED: "BOOKING_RESCHEDULED",
  BOOKING_RESCHEDULE_REQUESTED: "BOOKING_RESCHEDULE_REQUESTED",
  BOOKING_SERVICE_CHANGED: "BOOKING_SERVICE_CHANGED",
  BOOKING_REMINDER_24H: "BOOKING_REMINDER_24H",
  BOOKING_REMINDER_1H: "BOOKING_REMINDER_1H",
} as const;

export type NotificationTemplateKey =
  (typeof NotificationTemplate)[keyof typeof NotificationTemplate];
