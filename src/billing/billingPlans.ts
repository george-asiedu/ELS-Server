export type Plan = "STANDARD" | "PREMIUM";
export type Cadence = "MONTHLY" | "YEARLY";

// Studio billing uses one-time Mobile Money charges per period rather than
// Paystack subscriptions: MoMo (the payment method Ghana studios use) cannot be
// tokenized for automatic recurring billing, so a studio pays for a period up
// front and renews manually before it lapses.

// Prices are set by the super admin (PlatformConfig); see planPriceFor and
// loadBillingConfig in platform/platformService.
export const toPesewas = (ghs: number): number => Math.round(ghs * 100);

// End of a fresh billing period starting at `from`.
export const addPeriod = (from: Date, cadence: Cadence): Date => {
  const d = new Date(from);
  if (cadence === "YEARLY") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
};

// `months` calendar months after `from` (a setup fee's covered period).
export const addMonths = (from: Date, months: number): Date => {
  const d = new Date(from);
  d.setMonth(d.getMonth() + months);
  return d;
};

// Renewals extend from whichever is later — the current period end (so unused
// days aren't lost) or now (if the studio already lapsed).
export const extendPeriod = (
  current: Date | null | undefined,
  cadence: Cadence,
): Date => {
  const now = new Date();
  const base = current && current > now ? current : now;
  return addPeriod(base, cadence);
};

export const isLapsed = (currentPeriodEnd: Date | null | undefined): boolean =>
  !currentPeriodEnd || currentPeriodEnd.getTime() < Date.now();
