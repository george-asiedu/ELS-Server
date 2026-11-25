import { Connection } from "../db/dbConnection";
import { studioLink } from "../utils/studioLink";
import { ApiError } from "../middleware/apiError";
import { HttpCode } from "../models/status_codes";
import { paystack } from "../payment/paystackClient";
import { env } from "../config/env.config";
import { shortId } from "../utils/shortId";
import { planFlags, loadBillingConfig } from "../platform/platformService";
import { AuditService } from "../audit/auditService";
import {
  Plan,
  Cadence,
  toPesewas,
  extendPeriod,
  isLapsed,
  subtractPeriod,
  isPlan,
  planName as planNameFor,
} from "./billingPlans";
import {
  STUDIO_PRICE_SELECT,
  activeDiscount,
  countPromoUse,
  promoPercent,
  studioPriceFor,
} from "./studioPricing";
import { runAsSuperAdmin } from "../tenant/context";
import { NotificationService } from "../notifications/notificationService";
import { NotificationTemplate } from "../notifications/registry";
import {
  subscriptionExpiringSoon,
  subscriptionExpired,
} from "../notifications/templates/subscription";
import { markExtrasBilled, pendingExtras, reserveExtras } from "./extraCharges";
import { platformBrandForPlan } from "../notifications/brand";
import { ghs } from "../notifications/format";

/**
 * A studio's own billing with the platform: what it pays, renewals, plan
 * changes, extra charges, applying a paid charge, and the expiry reminders.
 * Moved out of StudioService unchanged; StudioService still exposes the same
 * methods (delegating here) so callers did not change.
 */
export class StudioBillingService extends Connection {
  private notifications = new NotificationService();

  private audit = new AuditService();

  private requireStudioId(studioId: string | null | undefined): string {
    if (!studioId) {
      throw new ApiError("Studio context missing", HttpCode.NOT_FOUND);
    }
    return studioId;
  }

  private async ownerEmail(studioId: string): Promise<string> {
    const studio = await this.studio.findUnique({
      where: { id: studioId },
      select: { ownerUserId: true },
    });
    const owner = studio?.ownerUserId
      ? await this.user.findUnique({
          where: { id: studio.ownerUserId },
          select: { email: true },
        })
      : null;
    if (!owner?.email) {
      throw new ApiError("Studio owner email is missing", HttpCode.BAD_REQUEST);
    }
    return owner.email;
  }

  public async getBilling(studioId: string | null | undefined) {
    const id = this.requireStudioId(studioId);
    const s = await this.studio.findUnique({
      where: { id },
      select: {
        billingCadence: true,
        billingMode: true,
        platformFeePercent: true,
        subscriptionStatus: true,
        currentPeriodEnd: true,
        status: true,
        ...STUDIO_PRICE_SELECT,
      },
    });
    if (!s) throw new ApiError("Studio not found", HttpCode.NOT_FOUND);
    const cfg = await loadBillingConfig();
    // What this studio pays per period for each plan, after its own terms.
    const yourPrices = Object.fromEntries(
      (["STANDARD", "PREMIUM", "STOREFRONT"] as Plan[]).map((p) => [
        p,
        {
          MONTHLY: studioPriceFor(s, p, "MONTHLY", cfg).amount,
          YEARLY: studioPriceFor(s, p, "YEARLY", cfg).amount,
        },
      ]),
    );
    // Revenue-share studios have no billing period, so they never "lapse" —
    // the platform earns its cut per transaction instead.
    const revenueShare = s.billingMode === "REVENUE_SHARE";
    const lapsed = revenueShare ? false : isLapsed(s.currentPeriodEnd);
    const extras = await pendingExtras(
      id,
      s.billingCadence === "YEARLY" ? "YEARLY" : "MONTHLY",
    );
    return {
      message: "Billing",
      data: {
        // On top of the plan: added to the next renewal.
        extras,
        plan: s.plan,
        cadence: s.billingCadence,
        billingMode: s.billingMode,
        commissionPercent: revenueShare ? s.platformFeePercent : 0,
        yourPrices,
        // A suspended account pays this on top of the plan to come back.
        suspended: s.status === "SUSPENDED",
        reactivationFee: s.status === "SUSPENDED" ? cfg.reactivationFee : 0,
        discountPercent: activeDiscount(s),
        discountEndsAt: activeDiscount(s) ? s.billingDiscountEndsAt : null,
        // Derived from the period end so the UI always reflects reality even if
        // no webhook fired: "active" while paid, "lapsed" once the period ends.
        subscriptionStatus: revenueShare
          ? "revenue_share"
          : lapsed
            ? "lapsed"
            : "active",
        currentPeriodEnd: s.currentPeriodEnd,
        lapsed,
      },
    };
  }

  /**
   * Record a studio-to-platform charge (a renewal or a plan change) and hand
   * it to Paystack. What it is for and what it costs are fixed here; applying
   * it later uses only these stored values.
   */
  private async startCharge(
    studioId: string,
    kind: "RENEWAL" | "PLAN_CHANGE",
    plan: Plan,
    cadence: Cadence,
    rawPromo?: unknown,
  ) {
    const studio = await this.studio.findUnique({
      where: { id: studioId },
      select: { ...STUDIO_PRICE_SELECT, status: true },
    });
    const billingCfg = await loadBillingConfig();
    const promo = await promoPercent(rawPromo, plan);
    const { amount } = studioPriceFor(studio, plan, cadence, billingCfg, promo);
    if (!(amount > 0)) {
      throw new ApiError(
        "This charge comes to nothing. Contact us to apply it.",
        HttpCode.BAD_REQUEST,
      );
    }
    // A renewal also settles what the studio owes on top of its plan (feature
    // request fees, extra storage, training), added after any promo discount.
    const extras =
      kind === "RENEWAL"
        ? await pendingExtras(studioId, cadence)
        : { items: [], total: 0 };
    // Bringing a suspended account back costs the reactivation fee on top of
    // the plan, so the total includes the subscription.
    const reactivationFee =
      kind === "RENEWAL" && studio?.status === "SUSPENDED"
        ? billingCfg.reactivationFee
        : 0;
    const chargeAmount =
      Math.round((amount + extras.total + reactivationFee) * 100) / 100;
    const email = await this.ownerEmail(studioId);
    const reference = `${kind === "RENEWAL" ? "ZURI-RENEW-" : "ZURI-BILLING-"}${shortId()}`;
    await this.studioBillingCharge.create({
      data: {
        reference,
        studioId,
        kind,
        plan,
        cadence,
        amount: chargeAmount,
        ...(promo.code ? { promoCode: promo.code } : {}),
      },
    });
    if (extras.items.length) await reserveExtras(studioId, reference);
    const init = await paystack.initialize({
      email,
      amountPesewas: toPesewas(chargeAmount),
      reference,
      // Back to the studio's own site, where its admin is signed in.
      callbackUrl: await this.linkToStudio("/admin/billing", studioId),
      metadata: {
        kind: kind === "RENEWAL" ? "renewal" : "billing",
        studioId,
        plan,
        cadence,
      },
    });
    return {
      reference,
      accessCode: init.access_code,
      publicKey: env.paystack.publicKey,
    };
  }

  // Start a plan/cadence change: charge the new plan's price once. On success
  // the frontend calls applyBillingChange() (the webhook applies it too).
  public async startBillingChange(
    studioId: string | null | undefined,
    plan: string,
    cadence: string,
    promoCode?: unknown,
  ) {
    const id = this.requireStudioId(studioId);
    if (!isPlan(plan)) {
      throw new ApiError("Invalid plan", HttpCode.BAD_REQUEST);
    }
    if (!["MONTHLY", "YEARLY"].includes(cadence)) {
      throw new ApiError("Invalid cadence", HttpCode.BAD_REQUEST);
    }
    const studio = await this.studio.findUnique({
      where: { id },
      select: { plan: true, billingCadence: true, billingMode: true },
    });
    if (!studio) throw new ApiError("Studio not found", HttpCode.NOT_FOUND);
    // Zuri Stores and the studio plans are different products: a
    // storefront can change billing period, a studio can move between
    // Standard and Premium, but neither crosses over.
    if ((plan === "STOREFRONT") !== (studio.plan === "STOREFRONT")) {
      throw new ApiError(
        "Storefront and studio plans can't be switched between. Contact us if you need to.",
        HttpCode.BAD_REQUEST,
      );
    }
    // A pay-as-you-earn studio may move to a recurring plan (this is the switch
    // itself, so any plan/cadence is allowed). The reverse isn't offered.
    if (
      studio.billingMode !== "REVENUE_SHARE" &&
      studio.plan === plan &&
      studio.billingCadence === cadence
    ) {
      throw new ApiError("You're already on this plan", HttpCode.BAD_REQUEST);
    }
    const data = await this.startCharge(
      id,
      "PLAN_CHANGE",
      plan as Plan,
      cadence as Cadence,
      promoCode,
    );
    return { message: "Plan change started", data };
  }

  // Renew the current plan for another period (manual, before/after lapse).
  public async startRenewal(
    studioId: string | null | undefined,
    promoCode?: unknown,
  ) {
    const id = this.requireStudioId(studioId);
    const studio = await this.studio.findUnique({
      where: { id },
      select: { plan: true, billingCadence: true, billingMode: true },
    });
    if (!studio) throw new ApiError("Studio not found", HttpCode.NOT_FOUND);
    if (studio.billingMode === "REVENUE_SHARE") {
      throw new ApiError(
        "Your account bills per transaction — there's nothing to renew.",
        HttpCode.BAD_REQUEST,
      );
    }
    const data = await this.startCharge(
      id,
      "RENEWAL",
      studio.plan as Plan,
      studio.billingCadence as Cadence,
      promoCode,
    );
    return { message: "Renewal started", data };
  }

  /**
   * Pay what's owed on top of the plan (feature request fees, storage,
   * training) now rather than at the next renewal. This is also how a studio
   * that pays per transaction, and so has no renewal, settles them.
   */
  public async startExtrasPayment(studioId: string | null | undefined) {
    const id = this.requireStudioId(studioId);
    const studio = await this.studio.findUnique({
      where: { id },
      select: { plan: true, billingCadence: true },
    });
    if (!studio) throw new ApiError("Studio not found", HttpCode.NOT_FOUND);
    const extras = await pendingExtras(
      id,
      studio.billingCadence === "YEARLY" ? "YEARLY" : "MONTHLY",
      false,
    );
    if (!(extras.total > 0))
      throw new ApiError(
        "There's nothing to pay right now",
        HttpCode.BAD_REQUEST,
      );
    const email = await this.ownerEmail(id);
    const reference = `ZURI-BILLING-${shortId()}`;
    await this.studioBillingCharge.create({
      data: {
        reference,
        studioId: id,
        kind: "EXTRAS",
        plan: studio.plan,
        cadence: studio.billingCadence,
        amount: extras.total,
      },
    });
    await reserveExtras(id, reference);
    const init = await paystack.initialize({
      email,
      amountPesewas: toPesewas(extras.total),
      reference,
      callbackUrl: await this.linkToStudio("/admin/billing", id),
      metadata: { kind: "extras", studioId: id },
    });
    return {
      message: "Payment started",
      data: {
        reference,
        accessCode: init.access_code,
        publicKey: env.paystack.publicKey,
      },
    };
  }

  public async applyExtrasPayment(
    studioId: string | null | undefined,
    reference: string,
  ) {
    const id = this.requireStudioId(studioId);
    await this.applyBillingCharge(reference, { studioId: id, kind: "EXTRAS" });
    return this.getBilling(id);
  }

  // The studio admin's return from checkout. The plan and cadence come from
  // the charge recorded at start, never from the request.
  public async applyBillingChange(
    studioId: string | null | undefined,
    reference: string,
  ) {
    const id = this.requireStudioId(studioId);
    await this.applyBillingCharge(reference, {
      studioId: id,
      kind: "PLAN_CHANGE",
    });
    return this.getBilling(id);
  }

  public async applyRenewal(
    studioId: string | null | undefined,
    reference: string,
  ) {
    const id = this.requireStudioId(studioId);
    // Read the period before applying, to know where the new one starts:
    // today if the plan had lapsed, else the old end date (renewing early
    // adds on, it doesn't cut the remaining time short).
    const before = await this.studio.findUnique({
      where: { id },
      select: { currentPeriodEnd: true },
    });
    const result = await this.applyBillingCharge(reference, {
      studioId: id,
      kind: "RENEWAL",
    });
    const billing = await this.getBilling(id);
    const charge = await this.studioBillingCharge.findUnique({
      where: { reference },
      select: {
        plan: true,
        cadence: true,
        amount: true,
        appliedAt: true,
      },
    });
    const after = await this.studio.findUnique({
      where: { id },
      select: { currentPeriodEnd: true },
    });
    const periodEnd = after?.currentPeriodEnd ?? null;
    const wasLapsed = isLapsed(before?.currentPeriodEnd);
    // Applied here: the start is what extendPeriod built on. Applied earlier
    // (the webhook got there first): step back one period from the end.
    const periodStart =
      result === "applied"
        ? wasLapsed
          ? (charge?.appliedAt ?? new Date())
          : before!.currentPeriodEnd
        : periodEnd && charge
          ? subtractPeriod(periodEnd, charge.cadence)
          : null;
    return {
      ...billing,
      data: {
        ...billing.data,
        renewal: charge
          ? {
              reference,
              plan: charge.plan,
              cadence: charge.cadence,
              amount: charge.amount,
              currency: "GHS",
              paidAt: charge.appliedAt,
              periodStart,
              periodEnd,
              // Only knowable when this call applied it.
              wasLapsed: result === "applied" ? wasLapsed : null,
            }
          : null,
      },
    };
  }

  /**
   * Apply a paid renewal or plan change, exactly once.
   *
   * Called from the studio admin's return from checkout, the Paystack webhook
   * and the reconciliation sweep, so a studio that pays and closes the tab is
   * still renewed. Before this, the plan came from the request (a Standard
   * monthly payment could be applied as Premium yearly) and nothing stopped a
   * paid reference being applied again and again.
   */
  public async applyBillingCharge(
    reference: string,
    expect: {
      studioId?: string;
      kind?: "RENEWAL" | "PLAN_CHANGE" | "EXTRAS";
    } = {},
  ): Promise<"applied" | "already_applied"> {
    const charge = await this.studioBillingCharge.findUnique({
      where: { reference },
    });
    if (
      !charge ||
      (expect.studioId && charge.studioId !== expect.studioId) ||
      (expect.kind && charge.kind !== expect.kind)
    ) {
      throw new ApiError("Payment not found", HttpCode.NOT_FOUND);
    }
    if (charge.status === "APPLIED") return "already_applied";

    let confirmed = false;
    try {
      const data = await paystack.verify(reference);
      confirmed =
        data.status === "success" &&
        Number(data.amount) >= toPesewas(charge.amount);
    } catch {
      confirmed = false;
    }
    if (!confirmed) {
      throw new ApiError("Payment not confirmed", HttpCode.BAD_REQUEST);
    }

    // Claim it: only one caller (admin return, webhook, sweep) gets past here.
    const claimed = await this.studioBillingCharge.updateMany({
      where: { id: charge.id, status: "PENDING" },
      data: { status: "APPLIED", appliedAt: new Date() },
    });
    if (claimed.count === 0) return "already_applied";

    try {
      if (charge.kind === "RENEWAL") {
        await this.renewFromCharge(charge);
        await markExtrasBilled(charge.studioId, charge.reference);
      } else if (charge.kind === "EXTRAS") {
        // No change to the plan or period: this only settles what's owed on top.
        await markExtrasBilled(charge.studioId, charge.reference);
      } else await this.changePlanFromCharge(charge);
      await countPromoUse(charge.promoCode);
    } catch (error) {
      // Nothing changed for the studio, so release the claim for a retry.
      await this.studioBillingCharge.update({
        where: { id: charge.id },
        data: { status: "PENDING", appliedAt: null },
      });
      throw error;
    }
    return "applied";
  }

  private async renewFromCharge(charge: {
    reference: string;
    studioId: string;
    cadence: Cadence;
    amount: number;
  }) {
    const studio = await this.studio.findUnique({
      where: { id: charge.studioId },
      select: { currentPeriodEnd: true, status: true },
    });
    if (!studio) throw new ApiError("Studio not found", HttpCode.NOT_FOUND);
    await this.studio.update({
      where: { id: charge.studioId },
      data: {
        subscriptionStatus: "active",
        currentPeriodEnd: extendPeriod(studio.currentPeriodEnd, charge.cadence),
        ...(studio.status === "SUSPENDED" ? { status: "ACTIVE" } : {}),
      },
    });
    await this.audit.record({
      action: "payment.renewal.succeeded",
      targetType: "Studio",
      targetId: charge.studioId,
      studioId: charge.studioId,
      metadata: {
        kind: "renewal",
        reference: charge.reference,
        cadence: charge.cadence,
        amount: charge.amount,
        currency: "GHS",
      },
    });
  }

  private async changePlanFromCharge(charge: {
    reference: string;
    studioId: string;
    plan: Plan;
    cadence: Cadence;
    amount: number;
  }) {
    const studio = await this.studio.findUnique({
      where: { id: charge.studioId },
    });
    if (!studio) throw new ApiError("Studio not found", HttpCode.NOT_FOUND);

    // Leaving pay-as-you-earn: stop taking a per-transaction cut, including on
    // the Paystack subaccount, before the studio is switched over.
    const fromRevenueShare = studio.billingMode === "REVENUE_SHARE";
    if (fromRevenueShare && studio.paystackSubaccountCode) {
      try {
        await paystack.updateSubaccount(studio.paystackSubaccountCode, {
          percentageCharge: 0,
        });
      } catch (error) {
        throw new ApiError(
          `Payment received, but we couldn't update your payout settings (${
            error instanceof Error ? error.message : "Paystack error"
          }). Please contact support — you have not been charged twice.`,
          HttpCode.BAD_GATEWAY,
        );
      }
    }

    // A plan change starts a fresh period from now.
    await this.studio.update({
      where: { id: charge.studioId },
      data: {
        plan: charge.plan,
        billingCadence: charge.cadence,
        subscriptionStatus: "active",
        currentPeriodEnd: extendPeriod(null, charge.cadence),
        ...(fromRevenueShare
          ? { billingMode: "SUBSCRIPTION" as const, platformFeePercent: 0 }
          : {}),
      },
    });
    const flags = planFlags(charge.plan);
    await this.studioSettings.upsert({
      where: { studioId: charge.studioId },
      update: flags,
      create: { studioId: charge.studioId, ...flags },
    });
    await this.audit.record({
      action: "payment.plan_change.succeeded",
      targetType: "Studio",
      targetId: charge.studioId,
      studioId: charge.studioId,
      metadata: {
        kind: "plan_change",
        reference: charge.reference,
        plan: charge.plan,
        cadence: charge.cadence,
        amount: charge.amount,
        currency: "GHS",
      },
    });
  }

  // ---- Admin: loyalty cap ----------------------------------------------

  // Background sweep (see queue/workers/billingReminderWorker.ts, run on a
  // cron schedule): emails SUBSCRIPTION-mode studio owners as their paid
  // period approaches or has passed. Manual-renewal billing (see
  // billing/billingPlans.ts) never auto-charges or auto-suspends — this is
  // purely a reminder so an owner doesn't get caught out. Runs across every
  // studio, so it must run in the super-admin context.
  public async checkBillingReminders() {
    return runAsSuperAdmin(async () => {
      const now = new Date();
      const soonCutoff = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
      const billingConfig = await loadBillingConfig();

      const studios = await this.studio.findMany({
        where: {
          billingMode: "SUBSCRIPTION",
          currentPeriodEnd: { lt: soonCutoff },
        },
        select: {
          id: true,
          name: true,
          plan: true,
          billingCadence: true,
          currentPeriodEnd: true,
          ownerUserId: true,
          slug: true,
          customPriceMonthly: true,
          billingDiscountPercent: true,
          billingDiscountEndsAt: true,
        },
      });

      const owners = await this.user.findMany({
        where: {
          id: { in: studios.flatMap((s) => s.ownerUserId ?? []) },
        },
        select: { id: true, email: true },
      });
      const ownerById = new Map(owners.map((o) => [o.id, o]));

      let expiringSoon = 0;
      let expired = 0;
      for (const studio of studios) {
        if (!studio.ownerUserId || !studio.currentPeriodEnd) continue;
        const owner = ownerById.get(studio.ownerUserId);
        if (!owner?.email) continue;

        const lapsed = isLapsed(studio.currentPeriodEnd);
        const planName = planNameFor(studio.plan);
        const periodKey = studio.currentPeriodEnd.toISOString().slice(0, 10);

        try {
          if (lapsed) {
            const { subject, html } = subscriptionExpired(
              platformBrandForPlan(studio.plan),
              {
                planName,
                expiredOn: studio.currentPeriodEnd.toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                }),
                reactivationFee: billingConfig.reactivationFee,
                reactivateUrl: studioLink(studio.slug, "/admin/billing"),
              },
            );
            await this.notifications.send({
              template: NotificationTemplate.SUBSCRIPTION_EXPIRED,
              to: owner.email,
              subject,
              html,
              studioId: studio.id,
              entityType: "Studio",
              entityId: `${studio.id}:expired:${periodKey}`,
            });
            expired++;
          } else {
            const amountDue = ghs(
              studioPriceFor(
                studio,
                studio.plan as Plan,
                studio.billingCadence as Cadence,
                billingConfig,
              ).amount,
            );
            const { subject, html } = subscriptionExpiringSoon(
              platformBrandForPlan(studio.plan),
              {
                planName,
                renewsOn: studio.currentPeriodEnd.toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                }),
                amountDue,
                reactivationFee: billingConfig.reactivationFee,
                manageUrl: studioLink(studio.slug, "/admin/billing"),
              },
            );
            await this.notifications.send({
              template: NotificationTemplate.SUBSCRIPTION_EXPIRING_SOON,
              to: owner.email,
              subject,
              html,
              studioId: studio.id,
              entityType: "Studio",
              entityId: `${studio.id}:expiring:${periodKey}`,
            });
            expiringSoon++;
          }
        } catch (error) {
          console.error(
            `Failed to send billing reminder for studio ${studio.id}:`,
            error,
          );
        }
      }

      return { checked: studios.length, expiringSoon, expired };
    });
  }
}
