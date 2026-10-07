import { Connection } from "../db/dbConnection";
import { S3BucketService } from "../bucket/s3BucketService";
import { ApiError } from "../middleware/apiError";
import { HttpCode } from "../models/status_codes";
import { paystack } from "../payment/paystackClient";
import { env } from "../config/env.config";
import { randomUUID } from "crypto";
import { shortId } from "../utils/shortId";
import { promises as dns } from "dns";
import {
  planFlags,
  planPriceFor,
  loadBillingConfig,
} from "../platform/platformService";
import { AuditService } from "../audit/auditService";
import {
  Plan,
  Cadence,
  toPesewas,
  extendPeriod,
  isLapsed,
} from "../billing/billingPlans";
import {
  resolveStudioByDomain,
  forgetStudioDomain,
} from "../tenant/studioResolver";
import { runAsSuperAdmin } from "../tenant/context";
import { NotificationService } from "../notifications/notificationService";
import { NotificationTemplate } from "../notifications/registry";
import {
  subscriptionExpiringSoon,
  subscriptionExpired,
} from "../notifications/templates/subscription";
import { platformBrand } from "../notifications/brand";
import { ghs } from "../notifications/format";

const DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/;
const normalizeDomain = (raw: string) =>
  String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const MAX_FEATURE_CARDS = 6;

// Normalize an incoming color: undefined = leave unchanged, "" = clear (null),
// a valid hex = store, anything else = 400.
const normalizeColor = (
  value: unknown,
  field: string,
): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const s = String(value).trim();
  if (!HEX_RE.test(s)) {
    throw new ApiError(
      `${field} must be a hex color like #4F46E5`,
      HttpCode.BAD_REQUEST,
    );
  }
  return s;
};

// Landing-page text a studio admin can set, with each field's length cap.
// Null (or blank) means the storefront shows its default wording.
const CONTENT_TEXT_LIMITS = {
  heroEyebrow: 40,
  heroHeadline: 100,
  heroSubtext: 300,
  aboutHeading: 120,
  aboutText: 500,
  featuresHeading: 120,
  servicesHeading: 120,
  galleryHeading: 120,
  reviewsHeading: 120,
  loyaltyHeading: 120,
  loyaltyText: 300,
  ctaHeading: 120,
  contactHeading: 120,
} as const;
type ContentTextField = keyof typeof CONTENT_TEXT_LIMITS;

// Landing-page images: uploaded through /uploads under the studio's "studio"
// media prefix, stored as their delivery URL.
const CONTENT_IMAGE_FIELDS = [
  "heroImageUrl",
  "aboutImageUrl",
  "ctaImageUrl",
] as const;
type ContentImageField = (typeof CONTENT_IMAGE_FIELDS)[number];

// Feature cards are stored as JSON; a string-indexed record keeps them
// assignable to Prisma's InputJsonValue.
type FeatureCard = Record<string, string>;

const sanitizeFeatureCards = (value: unknown): FeatureCard[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new ApiError("featureCards must be an array", HttpCode.BAD_REQUEST);
  }
  const cards = value.slice(0, MAX_FEATURE_CARDS).map((raw) => {
    const c = (raw ?? {}) as Record<string, unknown>;
    const title = String(c.title ?? "").trim();
    const description = String(c.description ?? "").trim();
    if (!title) {
      throw new ApiError(
        "Each feature card needs a title",
        HttpCode.BAD_REQUEST,
      );
    }
    return {
      icon: String(c.icon ?? "sparkles")
        .trim()
        .toLowerCase()
        .slice(0, 24),
      title: title.slice(0, 60),
      description: description.slice(0, 160),
    };
  });
  return cards;
};

/**
 * Studio-facing config: the public storefront view (read by the SPA) plus the
 * admin editors for a studio's own branding and landing content. Branding /
 * content are platform models keyed by studioId, so they're queried directly by
 * id (they aren't auto-scoped by the tenant extension).
 */
// References for a studio paying the platform (see startCharge).
export const isStudioBillingReference = (reference: string) =>
  reference.startsWith("ZURI-RENEW-") || reference.startsWith("ZURI-BILLING-");

export class StudioService extends Connection {
  private notifications = new NotificationService();

  private audit = new AuditService();

  constructor(private s3: S3BucketService) {
    super();
  }

  private requireStudioId(studioId: string | null | undefined): string {
    if (!studioId) {
      throw new ApiError("Studio context missing", HttpCode.NOT_FOUND);
    }
    return studioId;
  }

  // ---- Public storefront config ----------------------------------------

  public async getPublicConfig(studioId: string | null | undefined) {
    const id = this.requireStudioId(studioId);

    const studio = await this.studio.findUnique({
      where: { id },
      include: { branding: true, content: true, settings: true },
    });
    if (!studio) {
      throw new ApiError("Studio not found", HttpCode.NOT_FOUND);
    }

    return {
      name: studio.name,
      slug: studio.slug,
      branding: {
        logoUrl: this.s3.deliveryUrl(studio.branding?.logoUrl ?? null) ?? null,
        primaryColor: studio.branding?.primaryColor ?? null,
        accentColor: studio.branding?.accentColor ?? null,
        fontFamily: studio.branding?.fontFamily ?? null,
      },
      content: this.publicContent(studio.content),
      settings: {
        commerce: studio.settings?.commerce ?? false,
        loyalty: studio.settings?.loyalty ?? true,
        referrals: studio.settings?.referrals ?? true,
        reviews: studio.settings?.reviews ?? true,
        gallery: studio.settings?.gallery ?? true,
        onlinePayments: studio.settings?.onlinePayments ?? false,
        productsInBooking: studio.settings?.productsInBooking ?? false,
        loyaltyCapPercent: studio.settings?.loyaltyCapPercent ?? 30,
      },
    };
  }

  // ---- Admin: branding --------------------------------------------------

  public async getBranding(studioId: string | null | undefined) {
    const id = this.requireStudioId(studioId);
    const branding = await this.studioBranding.upsert({
      where: { studioId: id },
      update: {},
      create: { studioId: id },
    });
    branding.logoUrl = this.s3.deliveryUrl(branding.logoUrl);
    return { message: "Branding retrieved", data: branding };
  }

  public async updateBranding(
    studioId: string | null | undefined,
    input: {
      primaryColor?: unknown;
      accentColor?: unknown;
      fontFamily?: unknown;
      removeLogo?: unknown;
      logoUrl?: unknown;
    },
  ) {
    const id = this.requireStudioId(studioId);

    const data: {
      primaryColor?: string | null;
      accentColor?: string | null;
      fontFamily?: string | null;
      logoUrl?: string | null;
    } = {};

    const primary = normalizeColor(input.primaryColor, "primaryColor");
    if (primary !== undefined) data.primaryColor = primary;
    const accent = normalizeColor(input.accentColor, "accentColor");
    if (accent !== undefined) data.accentColor = accent;

    if (input.fontFamily !== undefined) {
      const font = String(input.fontFamily ?? "")
        .trim()
        .slice(0, 60);
      data.fontFamily = font || null;
    }

    if (input.logoUrl) {
      data.logoUrl = this.s3.assertOwnedMediaUrl(
        String(input.logoUrl),
        "studio",
      );
    } else if (input.removeLogo === true || input.removeLogo === "true") {
      data.logoUrl = null;
    }

    const branding = await this.studioBranding.upsert({
      where: { studioId: id },
      update: data,
      create: { studioId: id, ...data },
    });
    branding.logoUrl = this.s3.deliveryUrl(branding.logoUrl);
    return { message: "Branding updated", data: branding };
  }

  // ---- Custom domain ----------------------------------------------------

  private domainPayload(studio: {
    customDomain: string | null;
    customDomainVerified: boolean;
    customDomainVerifyToken: string | null;
  }) {
    const token = studio.customDomainVerifyToken;
    return {
      domain: studio.customDomain,
      verified: studio.customDomainVerified,
      // The DNS record the studio must add to prove ownership.
      txt: token
        ? {
            name: `_zuri-verify.${studio.customDomain}`,
            value: `zuri-verify=${token}`,
          }
        : null,
    };
  }

  public async getDomain(studioId: string | null | undefined) {
    const id = this.requireStudioId(studioId);
    const studio = await this.studio.findUnique({
      where: { id },
      select: {
        customDomain: true,
        customDomainVerified: true,
        customDomainVerifyToken: true,
      },
    });
    if (!studio) throw new ApiError("Studio not found", HttpCode.NOT_FOUND);
    return { message: "Custom domain", data: this.domainPayload(studio) };
  }

  public async setDomain(
    studioId: string | null | undefined,
    rawDomain: string,
  ) {
    const id = this.requireStudioId(studioId);
    const domain = normalizeDomain(rawDomain);
    if (!DOMAIN_RE.test(domain)) {
      throw new ApiError(
        "Enter a valid domain (e.g. book.mystudio.com)",
        HttpCode.BAD_REQUEST,
      );
    }
    const taken = await this.studio.findFirst({
      where: { customDomain: domain, id: { not: id } },
    });
    if (taken) {
      throw new ApiError("That domain is already in use", HttpCode.CONFLICT);
    }
    const token = randomUUID().replace(/-/g, "").slice(0, 24);
    const updated = await this.studio.update({
      where: { id },
      data: {
        customDomain: domain,
        customDomainVerifyToken: token,
        customDomainVerified: false,
      },
      select: {
        customDomain: true,
        customDomainVerified: true,
        customDomainVerifyToken: true,
      },
    });
    forgetStudioDomain(domain);
    return {
      message: "Domain saved — add the DNS record, then verify",
      data: this.domainPayload(updated),
    };
  }

  public async verifyDomain(studioId: string | null | undefined) {
    const id = this.requireStudioId(studioId);
    const studio = await this.studio.findUnique({
      where: { id },
      select: { customDomain: true, customDomainVerifyToken: true },
    });
    if (!studio?.customDomain || !studio.customDomainVerifyToken) {
      throw new ApiError("Add a domain first", HttpCode.BAD_REQUEST);
    }
    const expected = `zuri-verify=${studio.customDomainVerifyToken}`;
    let found = false;
    try {
      const records = await dns.resolveTxt(
        `_zuri-verify.${studio.customDomain}`,
      );
      found = records.some((chunks) => chunks.join("").includes(expected));
    } catch {
      found = false;
    }
    if (!found) {
      throw new ApiError(
        "TXT record not found yet. DNS changes can take a few minutes to propagate.",
        HttpCode.BAD_REQUEST,
      );
    }
    const updated = await this.studio.update({
      where: { id },
      data: { customDomainVerified: true },
      select: {
        customDomain: true,
        customDomainVerified: true,
        customDomainVerifyToken: true,
      },
    });
    forgetStudioDomain(studio.customDomain);
    return { message: "Domain verified", data: this.domainPayload(updated) };
  }

  // Public: map a host to a studio slug (for a SPA served from a custom domain).
  public async resolveByDomain(host: string) {
    const studio = await resolveStudioByDomain(host);
    if (!studio)
      throw new ApiError("No studio for this domain", HttpCode.NOT_FOUND);
    return { message: "Resolved", data: { slug: studio.slug } };
  }

  // ---- Admin: billing (one-time Mobile Money charge + manual renewal) ----
  //
  // Paystack subscriptions can only auto-charge a card. Ghana studios pay by
  // Mobile Money, which can't be tokenized for recurring billing, so a studio
  // pays for a period up front and renews manually before it lapses.

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
        plan: true,
        billingCadence: true,
        billingMode: true,
        platformFeePercent: true,
        subscriptionStatus: true,
        currentPeriodEnd: true,
      },
    });
    if (!s) throw new ApiError("Studio not found", HttpCode.NOT_FOUND);
    // Revenue-share studios have no billing period, so they never "lapse" —
    // the platform earns its cut per transaction instead.
    const revenueShare = s.billingMode === "REVENUE_SHARE";
    const lapsed = revenueShare ? false : isLapsed(s.currentPeriodEnd);
    return {
      message: "Billing",
      data: {
        plan: s.plan,
        cadence: s.billingCadence,
        billingMode: s.billingMode,
        commissionPercent: revenueShare ? s.platformFeePercent : 0,
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
  ) {
    const amount = planPriceFor(plan, cadence, await loadBillingConfig());
    const email = await this.ownerEmail(studioId);
    const reference = `${kind === "RENEWAL" ? "ZURI-RENEW-" : "ZURI-BILLING-"}${shortId()}`;
    await this.studioBillingCharge.create({
      data: { reference, studioId, kind, plan, cadence, amount },
    });
    const init = await paystack.initialize({
      email,
      amountPesewas: toPesewas(amount),
      reference,
      callbackUrl: `${env.clientUrl}/admin/billing`,
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
  ) {
    const id = this.requireStudioId(studioId);
    if (!["STANDARD", "PREMIUM"].includes(plan)) {
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
    );
    return { message: "Plan change started", data };
  }

  // Renew the current plan for another period (manual, before/after lapse).
  public async startRenewal(studioId: string | null | undefined) {
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
    );
    return { message: "Renewal started", data };
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
    await this.applyBillingCharge(reference, { studioId: id, kind: "RENEWAL" });
    return this.getBilling(id);
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
    expect: { studioId?: string; kind?: "RENEWAL" | "PLAN_CHANGE" } = {},
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
      if (charge.kind === "RENEWAL") await this.renewFromCharge(charge);
      else await this.changePlanFromCharge(charge);
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

  public async getLoyalty(studioId: string | null | undefined) {
    const id = this.requireStudioId(studioId);
    const settings = await this.studioSettings.upsert({
      where: { studioId: id },
      update: {},
      create: { studioId: id },
    });
    return {
      message: "Loyalty settings",
      data: { loyaltyCapPercent: settings.loyaltyCapPercent },
    };
  }

  public async updateLoyalty(
    studioId: string | null | undefined,
    input: { loyaltyCapPercent?: unknown },
  ) {
    const id = this.requireStudioId(studioId);
    const pct = Math.round(Number(input.loyaltyCapPercent));
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      throw new ApiError(
        "Loyalty cap must be between 0 and 100",
        HttpCode.BAD_REQUEST,
      );
    }
    await this.studioSettings.upsert({
      where: { studioId: id },
      update: { loyaltyCapPercent: pct },
      create: { studioId: id, loyaltyCapPercent: pct },
    });
    return this.getLoyalty(id);
  }

  // ---- Admin: content ---------------------------------------------------

  // Every editable landing field, with images rewritten to their delivery URL.
  private publicContent(
    content:
      | ({ featureCards: unknown; showTestimonials: boolean } & Record<
          ContentTextField | ContentImageField,
          string | null
        >)
      | null
      | undefined,
  ) {
    const text = Object.fromEntries(
      (Object.keys(CONTENT_TEXT_LIMITS) as ContentTextField[]).map((f) => [
        f,
        content?.[f] ?? null,
      ]),
    ) as Record<ContentTextField, string | null>;
    const images = Object.fromEntries(
      CONTENT_IMAGE_FIELDS.map((f) => [
        f,
        this.s3.deliveryUrl(content?.[f] ?? null) ?? null,
      ]),
    ) as Record<ContentImageField, string | null>;
    return {
      ...text,
      ...images,
      featureCards: content?.featureCards ?? null,
      showTestimonials: content?.showTestimonials ?? true,
    };
  }

  public async getContent(studioId: string | null | undefined) {
    const id = this.requireStudioId(studioId);
    const content = await this.studioContent.upsert({
      where: { studioId: id },
      update: {},
      create: { studioId: id },
    });
    return { message: "Content retrieved", data: this.publicContent(content) };
  }

  // ---- Admin: payout (Paystack subaccount for split settlement) ---------

  public async getPayout(studioId: string | null | undefined) {
    const id = this.requireStudioId(studioId);
    const studio = await this.studio.findUnique({
      where: { id },
      select: {
        paystackSubaccountCode: true,
        platformFeePercent: true,
        payoutType: true,
        payoutProvider: true,
        payoutAccountNumber: true,
        payoutAccountName: true,
      },
    });
    if (!studio) throw new ApiError("Studio not found", HttpCode.NOT_FOUND);

    // Settlement options: mobile-money networks and regular banks. Fetched in
    // parallel; either may be empty if Paystack is unreachable.
    let providers: { name: string; code: string }[] = [];
    let banks: { name: string; code: string }[] = [];
    const [momoRes, bankRes] = await Promise.allSettled([
      paystack.listMobileMoneyBanks(),
      paystack.listBanks(),
    ]);
    if (momoRes.status === "fulfilled") {
      providers = momoRes.value.map((b) => ({ name: b.name, code: b.code }));
    }
    if (bankRes.status === "fulfilled") {
      banks = bankRes.value.map((b) => ({ name: b.name, code: b.code }));
    }

    return {
      message: "Payout settings",
      data: {
        connected: Boolean(studio.paystackSubaccountCode),
        platformFeePercent: studio.platformFeePercent,
        type: studio.payoutType ?? "momo",
        provider: studio.payoutProvider,
        accountNumber: studio.payoutAccountNumber,
        accountName: studio.payoutAccountName,
        providers,
        banks,
      },
    };
  }

  // Look up the registered name for a mobile-money number so the admin doesn't
  // type it (and to catch typos before saving the payout account).
  public async resolvePayoutAccount(
    studioId: string | null | undefined,
    accountNumber: string,
    provider: string,
  ) {
    this.requireStudioId(studioId);
    const number = String(accountNumber ?? "").trim();
    const bankCode = String(provider ?? "").trim();
    if (!/^\d{9,20}$/.test(number)) {
      throw new ApiError("Enter a valid account number", HttpCode.BAD_REQUEST);
    }
    if (!bankCode) {
      throw new ApiError("Select a provider or bank", HttpCode.BAD_REQUEST);
    }
    try {
      const res = await paystack.resolveAccount({
        accountNumber: number,
        bankCode,
      });
      return {
        message: "Account resolved",
        data: { accountName: res.account_name },
      };
    } catch (error) {
      throw new ApiError(
        error instanceof ApiError
          ? `Paystack: ${error.message}`
          : "Could not verify that account",
        HttpCode.BAD_GATEWAY,
      );
    }
  }

  public async updatePayout(
    studioId: string | null | undefined,
    input: {
      type?: unknown;
      provider?: unknown;
      accountNumber?: unknown;
      accountName?: unknown;
    },
  ) {
    const id = this.requireStudioId(studioId);
    const type =
      String(input.type ?? "momo").trim() === "bank" ? "bank" : "momo";
    const provider = String(input.provider ?? "").trim(); // Paystack settlement code
    const accountNumber = String(input.accountNumber ?? "").trim();
    const accountName = String(input.accountName ?? "").trim();

    if (!provider) {
      throw new ApiError(
        type === "bank" ? "Select a bank" : "Select a mobile-money network",
        HttpCode.BAD_REQUEST,
      );
    }
    if (!/^\d{9,20}$/.test(accountNumber)) {
      throw new ApiError(
        type === "bank"
          ? "Enter a valid bank account number"
          : "Enter a valid mobile-money number",
        HttpCode.BAD_REQUEST,
      );
    }
    if (accountName.length < 2) {
      throw new ApiError("An account name is required", HttpCode.BAD_REQUEST);
    }

    const studio = await this.studio.findUnique({
      where: { id },
      select: {
        name: true,
        paystackSubaccountCode: true,
        platformFeePercent: true,
        ownerUserId: true,
      },
    });
    if (!studio) throw new ApiError("Studio not found", HttpCode.NOT_FOUND);

    const ownerEmail = studio.ownerUserId
      ? (
          await this.user.findUnique({
            where: { id: studio.ownerUserId },
            select: { email: true },
          })
        )?.email
      : undefined;

    let code = studio.paystackSubaccountCode ?? null;
    try {
      if (code) {
        await paystack.updateSubaccount(code, {
          businessName: accountName || studio.name,
          settlementBank: provider,
          accountNumber,
          percentageCharge: studio.platformFeePercent,
        });
      } else {
        const created = await paystack.createSubaccount({
          businessName: accountName || studio.name,
          settlementBank: provider,
          accountNumber,
          percentageCharge: studio.platformFeePercent,
          ...(ownerEmail ? { primaryContactEmail: ownerEmail } : {}),
        });
        code = created.subaccount_code;
      }
    } catch (error) {
      throw new ApiError(
        error instanceof ApiError
          ? `Paystack: ${error.message}`
          : "Could not save payout account with Paystack",
        HttpCode.BAD_GATEWAY,
      );
    }

    await this.studio.update({
      where: { id },
      data: {
        paystackSubaccountCode: code,
        payoutType: type,
        payoutProvider: provider,
        payoutAccountNumber: accountNumber,
        payoutAccountName: accountName,
      },
    });

    return this.getPayout(id);
  }

  public async updateContent(
    studioId: string | null | undefined,
    input: Partial<Record<ContentTextField | ContentImageField, unknown>> & {
      featureCards?: unknown;
      showTestimonials?: unknown;
    },
  ) {
    const id = this.requireStudioId(studioId);

    const data: Partial<
      Record<ContentTextField | ContentImageField, string | null>
    > & {
      featureCards?: FeatureCard[];
      showTestimonials?: boolean;
    } = {};

    // Omitted = leave unchanged; blank = back to the default.
    for (const [field, max] of Object.entries(CONTENT_TEXT_LIMITS) as [
      ContentTextField,
      number,
    ][]) {
      if (input[field] === undefined) continue;
      const s = String(input[field] ?? "").trim();
      data[field] = s ? s.slice(0, max) : null;
    }

    // Images must be this studio's own uploads, so a page can't be pointed at
    // someone else's media or an arbitrary host.
    for (const field of CONTENT_IMAGE_FIELDS) {
      const value = input[field];
      if (value === undefined) continue;
      if (value === null || value === "") {
        data[field] = null;
        continue;
      }
      if (typeof value !== "string") {
        throw new ApiError(
          `${field} must be an image URL`,
          HttpCode.BAD_REQUEST,
        );
      }
      data[field] = this.s3.assertOwnedMediaUrl(value, "studio");
    }

    const cards = sanitizeFeatureCards(input.featureCards);
    if (cards !== undefined) data.featureCards = cards;

    if (input.showTestimonials !== undefined)
      data.showTestimonials = Boolean(input.showTestimonials);

    const content = await this.studioContent.upsert({
      where: { studioId: id },
      update: data,
      create: { studioId: id, ...data },
    });
    return { message: "Content updated", data: this.publicContent(content) };
  }

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
        },
      });

      let expiringSoon = 0;
      let expired = 0;
      for (const studio of studios) {
        if (!studio.ownerUserId || !studio.currentPeriodEnd) continue;
        const owner = await this.user.findUnique({
          where: { id: studio.ownerUserId },
          select: { email: true },
        });
        if (!owner?.email) continue;

        const lapsed = isLapsed(studio.currentPeriodEnd);
        const planName = studio.plan === "PREMIUM" ? "Premium" : "Standard";
        const periodKey = studio.currentPeriodEnd.toISOString().slice(0, 10);

        try {
          if (lapsed) {
            const { subject, html } = subscriptionExpired(platformBrand, {
              planName,
              expiredOn: studio.currentPeriodEnd.toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                year: "numeric",
              }),
              reactivateUrl: `${env.clientUrl}/admin/billing`,
            });
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
              planPriceFor(
                studio.plan as Plan,
                studio.billingCadence as Cadence,
                billingConfig,
              ),
            );
            const { subject, html } = subscriptionExpiringSoon(platformBrand, {
              planName,
              renewsOn: studio.currentPeriodEnd.toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                year: "numeric",
              }),
              amountDue,
              manageUrl: `${env.clientUrl}/admin/billing`,
            });
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
