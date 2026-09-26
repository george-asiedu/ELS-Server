// Pre-format currency before it reaches a template — see notifications/types.ts
// (MoneyLine.value is a string, not a number) for why: our provider has no
// expression language to do this on the render side.
export const ghs = (amount: number): string => `GHS ${amount.toFixed(2)}`;

// Receipt timestamps. Ghana runs on UTC year-round (no DST), so formatting in
// UTC gives the customer their own local time without carrying a tz database.
export const receiptDate = (d: Date | null | undefined): string =>
  (d ?? new Date()).toLocaleString("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

// A short, human-quotable receipt number derived from a row id. Stable for a
// given payment/order, and distinct from the Paystack reference so the two
// can't be confused when a customer reads them out.
export const receiptNumber = (prefix: string, id: string): string =>
  `${prefix}-${id.slice(-8).toUpperCase()}`;

// Date without a time — for an appointment line that already carries its own
// slot time ("04 Oct 2026 · 09:00"), where receiptDate would repeat it.
export const receiptDayOnly = (d: Date | null | undefined): string =>
  (d ?? new Date()).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
