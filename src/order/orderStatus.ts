// Order stages, in one place. Everything from PAID up to FULFILLED is a paid
// order; queries about sales, revenue and purchases use PAID_ORDER_STATUSES so
// the in-between stages (preparing, ready, out for delivery) still count.
export const PAID_ORDER_STATUSES = ["PAID", "PREPARING", "READY_FOR_PICKUP", "OUT_FOR_DELIVERY", "FULFILLED"] as const;
export const ORDER_STATUSES = ["PENDING_PAYMENT", ...PAID_ORDER_STATUSES, "CANCELLED"] as const;
export type OrderStatusValue = (typeof ORDER_STATUSES)[number];
/** Paid, but not yet handed over: still cancellable by request. */
export const OPEN_PAID_STATUSES = ["PAID", "PREPARING", "READY_FOR_PICKUP", "OUT_FOR_DELIVERY"] as const;
