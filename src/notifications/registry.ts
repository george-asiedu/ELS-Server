// Centralized notification template registry (Section 36 naming from the
// design spec). Every notification the app sends is named here — nothing
// calls emailQueue/sendEmailNow directly with a hand-rolled subject/HTML
// string outside notifications/templates/*, so this list is a complete,
// accurate inventory of every email Zuri Studios sends.
//
// Deliberately NOT implemented (see notifications/README.md for why each one
// doesn't apply to this app's actual architecture today):
//   AUTH_VERIFY_EMAIL                     — no email-verification flow exists.
//   BOOKING_RESCHEDULED                   — no reschedule flow exists.
//   BOOKING_REMINDER_24H / _1H            — needs a new scheduled sweep over
//     upcoming appointments; a real follow-up, not implemented yet.
//   REFUND_SUCCESS / PARTIAL_REFUND       — no refund model/flow exists.
//   SHOP_ORDER_SHIPPED / tracking numbers — no shipping/tracking model exists
//     (fulfilment is PICKUP/DELIVERY only) — see SHOP_ORDER_FULFILLED instead.
//   STUDIO_ONBOARDING_COMPLETED checklist — "setup completeness" isn't modeled.
//   STUDIO_SETTLEMENT_SUCCESS/FAILED      — doesn't apply: Paystack subaccounts
//     settle directly to the studio's own account; the platform never holds
//     or transfers a studio's money, so there's no settlement event to report.
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
} as const;

export type NotificationTemplateKey =
  (typeof NotificationTemplate)[keyof typeof NotificationTemplate];
