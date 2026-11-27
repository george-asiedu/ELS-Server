// Centralized notification template registry (Section 36 naming from the
// design spec). Every notification the app sends is named here — nothing
// calls emailQueue/sendEmailNow directly with a hand-rolled subject/HTML
// string outside notifications/templates/*, so this list is a complete,
// accurate inventory of every email Zuri sends.
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
  AUTH_ACCOUNT_LOCKED: "AUTH_ACCOUNT_LOCKED",
  AUTH_EMAIL_VERIFICATION: "AUTH_EMAIL_VERIFICATION",
  CUSTOMER_WELCOME: "CUSTOMER_WELCOME",

  STUDIO_CREATED: "STUDIO_CREATED",
  STUDIO_ACCOUNT_SUSPENDED: "STUDIO_ACCOUNT_SUSPENDED",
  STUDIO_MONTHLY_REPORT: "STUDIO_MONTHLY_REPORT",

  BOOKING_REQUEST_CUSTOMER: "BOOKING_REQUEST_CUSTOMER",
  BOOKING_REQUEST_STUDIO: "BOOKING_REQUEST_STUDIO",
  BOOKING_COMPLETED: "BOOKING_COMPLETED",
  BOOKING_CANCELLED: "BOOKING_CANCELLED",

  PAYMENT_SUCCESS: "PAYMENT_SUCCESS",
  PAYMENT_FAILED: "PAYMENT_FAILED",

  SHOP_ORDER_CONFIRMED: "SHOP_ORDER_CONFIRMED",
  SHOP_ORDER_PAYMENT_FAILED: "SHOP_ORDER_PAYMENT_FAILED",
  SHOP_ORDER_FULFILLED: "SHOP_ORDER_FULFILLED",
  SHOP_ORDER_STAGE: "SHOP_ORDER_STAGE",

  SUBSCRIPTION_EXPIRING_SOON: "SUBSCRIPTION_EXPIRING_SOON",
  SUBSCRIPTION_EXPIRED: "SUBSCRIPTION_EXPIRED",

  // A studio asked the platform for a feature; and the studio being told how
  // that request is progressing.
  FEATURE_REQUEST_SUBMITTED_PLATFORM: "FEATURE_REQUEST_SUBMITTED_PLATFORM",
  FEATURE_REQUEST_STATUS_STUDIO: "FEATURE_REQUEST_STATUS_STUDIO",
  TRAINING_REQUEST_SUBMITTED_PLATFORM: "TRAINING_REQUEST_SUBMITTED_PLATFORM",
  TRAINING_SPOT_CONFIRMED_STUDIO: "TRAINING_SPOT_CONFIRMED_STUDIO",
  TRAINING_SPOT_RESERVED_PLATFORM: "TRAINING_SPOT_RESERVED_PLATFORM",
  FEATURE_REQUEST_FEE_STUDIO: "FEATURE_REQUEST_FEE_STUDIO",
  BILL_RECEIPT: "BILL_RECEIPT",
  BILL_ISSUED: "BILL_ISSUED",
  INSIGHTS_WEEKLY: "INSIGHTS_WEEKLY",

  REFUND_PROCESSED: "REFUND_PROCESSED",
  REFUND_FAILED: "REFUND_FAILED",
  REFUNDED_BY_STUDIO: "REFUNDED_BY_STUDIO",
  REVIEW_REQUEST: "REVIEW_REQUEST",
  WAITLIST_SLOT_OPEN: "WAITLIST_SLOT_OPEN",
  VOUCHER_DELIVERED: "VOUCHER_DELIVERED",

  BOOKING_CONFIRMED: "BOOKING_CONFIRMED",
  BOOKING_RESCHEDULED: "BOOKING_RESCHEDULED",
  BOOKING_RESCHEDULE_REQUESTED: "BOOKING_RESCHEDULE_REQUESTED",
  BOOKING_SERVICE_CHANGED: "BOOKING_SERVICE_CHANGED",
  BOOKING_REMINDER_24H: "BOOKING_REMINDER_24H",
  BOOKING_REMINDER_1H: "BOOKING_REMINDER_1H",
  // About to start, and the moment it is due: to the customer, and to the
  // person doing the service (or the studio's admins).
  BOOKING_STARTING_SOON: "BOOKING_STARTING_SOON",
  BOOKING_TIME_NOW: "BOOKING_TIME_NOW",
  BOOKING_ALERT_STAFF: "BOOKING_ALERT_STAFF",
  TRAINING_LIVE_STARTING_SOON: "TRAINING_LIVE_STARTING_SOON",
} as const;

export type NotificationTemplateKey =
  (typeof NotificationTemplate)[keyof typeof NotificationTemplate];
