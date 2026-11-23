import { createTenantClient } from "../tenant/tenantClient";
import { ApiError } from "../middleware/apiError";
import { HttpCode } from "../models/status_codes";
import type { Plan } from "./billingPlans";
import {
  BillingConfig,
  planPriceFor,
  YEARLY_MONTHS_CHARGED,
} from "../platform/platformService";

const { raw } = createTenantClient();
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface StudioPriceTerms {
  plan: string;
  customPriceMonthly: number | null;
  billingDiscountPercent: number | null;
  billingDiscountEndsAt: Date | null;
}

export const STUDIO_PRICE_SELECT = {
  plan: true,
  customPriceMonthly: true,
  billingDiscountPercent: true,
  billingDiscountEndsAt: true,
} as const;

/** The studio's own discount, if it's still running. */
export const activeDiscount = (s: StudioPriceTerms | null | undefined) =>
  s?.billingDiscountPercent &&
  s.billingDiscountPercent > 0 &&
  (!s.billingDiscountEndsAt || s.billingDiscountEndsAt > new Date())
    ? s.billingDiscountPercent
    : 0;

/** A usable promo's % off for this plan. Throws why it can't be used. */
export const promoPercent = async (rawCode: unknown, plan: Plan) => {
  const code = String(rawCode ?? "")
    .trim()
    .toUpperCase();
  if (!code) return { code: null, percent: 0 };
  const promo = await raw.billingPromo.findUnique({ where: { code } });
  if (
    !promo ||
    !promo.active ||
    (promo.expiresAt && promo.expiresAt < new Date()) ||
    (promo.maxUses !== null && promo.usedCount >= promo.maxUses) ||
    (promo.plans.length > 0 && !promo.plans.includes(plan))
  ) {
    throw new ApiError("That promo code isn't valid", HttpCode.BAD_REQUEST);
  }
  return { code: promo.code, percent: promo.percentOff };
};

/** Count a promo once the charge that used it is paid. */
export const countPromoUse = async (code: string | null | undefined) => {
  if (code) {
    await raw.billingPromo.updateMany({
      where: { code },
      data: { usedCount: { increment: 1 } },
    });
  }
};

/**
 * Take the better of the studio's own discount and a promo (they don't stack)
 * off an amount.
 */
export const discounted = (
  amount: number,
  studio: StudioPriceTerms | null | undefined,
  promo: { percent: number },
) => {
  const percent = Math.min(
    100,
    Math.max(activeDiscount(studio), promo.percent),
  );
  return { amount: round2(amount * (1 - percent / 100)), percent };
};

/**
 * What a studio pays for a plan and period: its custom price when the super
 * admin set one (for its current plan), else the list price; then discounts.
 */
export const studioPriceFor = (
  studio: StudioPriceTerms | null | undefined,
  plan: Plan,
  cadence: "MONTHLY" | "YEARLY",
  cfg: BillingConfig,
  promo: { percent: number } = { percent: 0 },
) => {
  const custom =
    studio?.customPriceMonthly != null && studio.plan === plan
      ? round2(
          studio.customPriceMonthly *
            (cadence === "YEARLY" ? YEARLY_MONTHS_CHARGED : 1),
        )
      : null;
  const list = custom ?? planPriceFor(plan, cadence, cfg);
  return { list, custom: custom !== null, ...discounted(list, studio, promo) };
};
