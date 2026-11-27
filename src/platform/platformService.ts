import { PAID_ORDER_STATUSES } from "../order/orderStatus";
import {
  CursorPage,
  cursorPageArgs,
  cursorPageResult,
} from "../utils/cursorPagination";
import { S3BucketService } from "../bucket/s3BucketService";
import { studioPriceFor } from "../billing/studioPricing";
import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import {
  isLapsed,
  byPlan,
  addMonths,
  type Plan,
} from "../billing/billingPlans";
import { HttpCode } from "../models/status_codes";
import { getPasswordHash } from "../utils/helper";
import { toWhatsappNumber, WHATSAPP_NUMBER_HINT } from "../utils/whatsapp";
import {
  createLoginSession,
  revokeStudioLoginSessions,
} from "../auth/sessionService";
import { forgetStudioSlug } from "../tenant/studioResolver";
import { paystack } from "../payment/paystackClient";
import { NotificationService } from "../notifications/notificationService";
import { NotificationTemplate } from "../notifications/registry";
import { studioAccountSuspended } from "../notifications/templates/studio";
import { platformBrand } from "../notifications/brand";
import { env } from "../config/env.config";
import { createTenantClient } from "../tenant/tenantClient";
import { randomBytes, createHash } from "crypto";
import { passwordResetRequested } from "../notifications/templates/auth";
import { platformBrandForPlan } from "../notifications/brand";
import { AuditService } from "../audit/auditService";
import { PlatformEarningsService } from "./platformEarningsService";

// Slugs that can never belong to a studio: they collide with platform routes,
// reserved subdomains, or the super-admin surface.
export const RESERVED_SLUGS = new Set([
  "platform",
  "admin",
  "api",
  "www",
  "app",
  "dashboard",
  "login",
  "signup",
  "static",
  "assets",
  "welcome",
  "s",
  "onboarding",
]);

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export const normalizeSlug = (raw: string) =>
  String(raw ?? "")
    .trim()
    .toLowerCase();

// Validate a studio slug, returning the normalized value or throwing 400.
export const validateStudioSlug = (raw: string): string => {
  const slug = normalizeSlug(raw);
  if (!SLUG_RE.test(slug) || slug.length < 2 || slug.length > 40) {
    throw new ApiError(
      "Slug must be 2-40 chars: lowercase letters, numbers and hyphens",
      HttpCode.BAD_REQUEST,
    );
  }
  if (RESERVED_SLUGS.has(slug)) {
    throw new ApiError("That slug is reserved", HttpCode.BAD_REQUEST);
  }
  return slug;
};

// Feature flags a plan unlocks. Standard: booking. Premium: booking and the
// shop. Storefront: the shop alone (no booking, gallery or add-ons).
export const planFlags = (plan: Plan) => ({
  booking: plan !== "STOREFRONT",
  commerce: plan !== "STANDARD",
  productsInBooking: plan === "PREMIUM",
  onlinePayments: true,
  loyalty: true,
  referrals: true,
  reviews: true,
  gallery: plan !== "STOREFRONT",
});

export interface BillingConfig {
  revenueShareEnabled: boolean;
  commissionStandardPercent: number;
  commissionPremiumPercent: number;
  // One-time activation fee for REVENUE_SHARE studios (covers no period).
  setupFeeStandard: number;
  setupFeePremium: number;
  setupFeeStorefront: number;
  commissionStorefrontPercent: number;
  // Subscription setup fee: a one-time fee added to the first period's price at
  // signup. 0 = no setup fee. (setupFeeMonths* below are no longer used.)
  subscriptionSetupFeeStandard: number;
  subscriptionSetupFeePremium: number;
  subscriptionSetupFeeStorefront: number;
  setupFeeMonthsMonthly: number;
  setupFeeMonthsYearly: number;
  // Plan prices (GHS) actually charged: the super admin's value, or the
  // built-in default when unset.
  priceStandardMonthly: number;
  priceStandardYearly: number;
  pricePremiumMonthly: number;
  pricePremiumYearly: number;
  priceStorefrontMonthly: number;
  priceStorefrontYearly: number;
  // Welcome discount for new subscription signups: % off the plan price for
  // the first N months. 0% = off.
  newStudioDiscountPercent: number;
  newStudioDiscountMonths: number;
  // Added to a renewal that brings a suspended account back (GHS, 0 = none).
  reactivationFee: number;
}

type PlatformConfigRow = Omit<
  BillingConfig,
  | "priceStandardMonthly"
  | "priceStandardYearly"
  | "pricePremiumMonthly"
  | "pricePremiumYearly"
  | "priceStorefrontMonthly"
  | "priceStorefrontYearly"
> & {
  priceStandardMonthly: number | null;
  priceStandardYearly: number | null;
  pricePremiumMonthly: number | null;
  pricePremiumYearly: number | null;
  priceStorefrontMonthly: number | null;
  priceStorefrontYearly: number | null;
};

// A yearly plan costs this many months of the monthly price: two months free,
// which the platform page advertises ("save 2 months"). Yearly prices are
// always derived from the monthly ones so the two can't drift apart. Mirrored
// by YEARLY_FREE_MONTHS in the frontend's config/platform.ts.
export const YEARLY_MONTHS_CHARGED = 10;
const yearlyFrom = (monthly: number) =>
  Math.round(monthly * YEARLY_MONTHS_CHARGED * 100) / 100;

const toBillingConfig = (row: PlatformConfigRow): BillingConfig => {
  const standardMonthly =
    row.priceStandardMonthly ?? env.paystack.prices.STANDARD_MONTHLY;
  const premiumMonthly =
    row.pricePremiumMonthly ?? env.paystack.prices.PREMIUM_MONTHLY;
  const storefrontMonthly =
    row.priceStorefrontMonthly ?? env.paystack.prices.STOREFRONT_MONTHLY;
  return {
    revenueShareEnabled: row.revenueShareEnabled,
    commissionStandardPercent: row.commissionStandardPercent,
    commissionPremiumPercent: row.commissionPremiumPercent,
    setupFeeStandard: row.setupFeeStandard,
    setupFeePremium: row.setupFeePremium,
    setupFeeStorefront: row.setupFeeStorefront,
    commissionStorefrontPercent: row.commissionStorefrontPercent,
    subscriptionSetupFeeStandard: row.subscriptionSetupFeeStandard,
    subscriptionSetupFeePremium: row.subscriptionSetupFeePremium,
    subscriptionSetupFeeStorefront: row.subscriptionSetupFeeStorefront,
    setupFeeMonthsMonthly: row.setupFeeMonthsMonthly,
    setupFeeMonthsYearly: row.setupFeeMonthsYearly,
    priceStandardMonthly: standardMonthly,
    priceStandardYearly: yearlyFrom(standardMonthly),
    pricePremiumMonthly: premiumMonthly,
    pricePremiumYearly: yearlyFrom(premiumMonthly),
    priceStorefrontMonthly: storefrontMonthly,
    priceStorefrontYearly: yearlyFrom(storefrontMonthly),
    newStudioDiscountPercent: row.newStudioDiscountPercent,
    newStudioDiscountMonths: row.newStudioDiscountMonths,
    reactivationFee: row.reactivationFee,
  };
};

/**
 * The platform's billing settings (prices, setup fees, revenue-share rates).
 * PlatformConfig is a single row, created with defaults on first read.
 */
export const loadBillingConfig = async (): Promise<BillingConfig> => {
  const { raw } = createTenantClient();
  const existing = await raw.platformConfig.findFirst();
  const row = existing ?? (await raw.platformConfig.create({ data: {} }));
  return toBillingConfig(row);
};

// Public details shown on the platform's own pages. Null = the frontend's
// built-in default for that field.
export interface SiteSettings {
  siteName: string | null;
  siteHeroBadge: string | null;
  supportEmail: string | null;
  supportWhatsapp: string | null;
  demoStudioSlug: string | null;
}

const SITE_FIELDS = [
  "siteName",
  "siteHeroBadge",
  "supportEmail",
  "supportWhatsapp",
  "demoStudioSlug",
] as const;

export const loadSiteSettings = async (): Promise<SiteSettings> => {
  const { raw } = createTenantClient();
  const row =
    (await raw.platformConfig.findFirst()) ??
    (await raw.platformConfig.create({ data: {} }));
  return Object.fromEntries(
    SITE_FIELDS.map((f) => [f, row[f]]),
  ) as unknown as SiteSettings;
};

/**
 * Validate and save the site details. Omitted = unchanged; blank = back to the
 * default. Each field is checked for what it is used as (a mail link, a wa.me
 * link, a studio address) so a typo can't break the page.
 */
export const saveSiteSettings = async (
  input: Partial<Record<keyof SiteSettings, unknown>>,
): Promise<SiteSettings> => {
  const data: Partial<Record<keyof SiteSettings, string | null>> = {};
  const text = (v: unknown, max: number) => {
    const t = String(v ?? "").trim();
    return t ? t.slice(0, max) : null;
  };
  if (input.siteName !== undefined) data.siteName = text(input.siteName, 60);
  if (input.siteHeroBadge !== undefined)
    data.siteHeroBadge = text(input.siteHeroBadge, 80);
  if (input.supportEmail !== undefined) {
    const v = text(input.supportEmail, 120)?.toLowerCase() ?? null;
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      throw new ApiError("Enter a valid support email", HttpCode.BAD_REQUEST);
    }
    data.supportEmail = v;
  }
  if (input.supportWhatsapp !== undefined) {
    // Stored as international digits: that's what a wa.me link needs.
    const raw = String(input.supportWhatsapp ?? "").trim();
    const number = raw ? toWhatsappNumber(raw) : null;
    if (raw && !number) {
      throw new ApiError(WHATSAPP_NUMBER_HINT, HttpCode.BAD_REQUEST);
    }
    data.supportWhatsapp = number;
  }
  if (input.demoStudioSlug !== undefined) {
    const slug = text(input.demoStudioSlug, 63)?.toLowerCase() ?? null;
    if (slug && !SLUG_RE.test(slug)) {
      throw new ApiError(
        'The demo studio must be a studio address like "els"',
        HttpCode.BAD_REQUEST,
      );
    }
    data.demoStudioSlug = slug;
  }
  const { raw } = createTenantClient();
  const existing =
    (await raw.platformConfig.findFirst()) ??
    (await raw.platformConfig.create({ data: {} }));
  await raw.platformConfig.update({ where: { id: existing.id }, data });
  return loadSiteSettings();
};

/** What a plan costs per period, in GHS. */
export const planPriceFor = (
  plan: Plan,
  cadence: "MONTHLY" | "YEARLY",
  cfg: BillingConfig,
): number => {
  const yearly = cadence === "YEARLY";
  return byPlan(plan, {
    STANDARD: yearly ? cfg.priceStandardYearly : cfg.priceStandardMonthly,
    PREMIUM: yearly ? cfg.pricePremiumYearly : cfg.pricePremiumMonthly,
    STOREFRONT: yearly ? cfg.priceStorefrontYearly : cfg.priceStorefrontMonthly,
  });
};

/**
 * The one-time setup fee (GHS) for a subscription plan, ADDED to the first
 * period's price at signup. 0 when the plan has none. The next renewal is the
 * plan's price alone.
 */
export const subscriptionSetupFeeFor = (
  plan: Plan,
  cfg: BillingConfig,
): number => {
  const fee = byPlan(plan, {
    STANDARD: cfg.subscriptionSetupFeeStandard,
    PREMIUM: cfg.subscriptionSetupFeePremium,
    STOREFRONT: cfg.subscriptionSetupFeeStorefront,
  });
  return fee > 0 ? fee : 0;
};

// Commission % the platform takes per transaction for a plan (REVENUE_SHARE).
export const commissionFor = (plan: Plan, cfg: BillingConfig): number =>
  byPlan(plan, {
    STANDARD: cfg.commissionStandardPercent,
    PREMIUM: cfg.commissionPremiumPercent,
    STOREFRONT: cfg.commissionStorefrontPercent,
  });

// One-time setup fee (GHS) charged at signup for a plan (REVENUE_SHARE).
export const setupFeeFor = (plan: Plan, cfg: BillingConfig): number =>
  byPlan(plan, {
    STANDARD: cfg.setupFeeStandard,
    PREMIUM: cfg.setupFeePremium,
    STOREFRONT: cfg.setupFeeStorefront,
  });

export interface StudioSettingsInput {
  booking?: boolean;
  commerce?: boolean;
  loyalty?: boolean;
  referrals?: boolean;
  reviews?: boolean;
  gallery?: boolean;
  onlinePayments?: boolean;
  productsInBooking?: boolean;
}

export interface ProvisionStudioInput {
  name: string;
  slug: string;
  ownerEmail: string;
  ownerPassword: string;
  ownerFullName?: string;
  customDomain?: string;
  plan?: Plan;
  settings?: StudioSettingsInput;
}

export interface ProvisionCoreInput {
  name: string;
  slug: string; // already validated + normalized
  ownerEmail: string; // already normalized
  ownerPasswordHash: string;
  ownerEmailVerified?: boolean;
  ownerFullName?: string;
  customDomain?: string;
  plan: Plan;
  cadence?: "MONTHLY" | "YEARLY";
  billingMode?: "SUBSCRIPTION" | "REVENUE_SHARE";
  // What a shop sells (picks its website template). Null for booking-only.
  shopCategory?: string | null;
  // Everything it sells; the first is shopCategory.
  shopCategories?: string[];
  // Kinds of studio it is; the first picks the website's wording.
  studioTypes?: string[];
  // Platform's per-transaction cut (subaccount percentage_charge). Set for
  // REVENUE_SHARE studios from the plan's configured commission; 0 otherwise.
  platformFeePercent?: number;
  subscription?: {
    customerCode?: string | null;
    subscriptionCode?: string | null;
    status?: string | null;
    currentPeriodEnd?: Date | null;
  };
  settingsOverride?: StudioSettingsInput;
  // Welcome discount: % off for the first `months` months from now.
  welcomeDiscount?: { percent: number; months: number } | null;
}

type StudioStatus = "ACTIVE" | "SUSPENDED" | "TRIAL";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Super-admin operations that span studios. Every method here runs inside the
 * platform (superAdmin) tenant context, so the tenant extension is bypassed and
 * studioId must be set explicitly on the documents we create.
 */
export class PlatformService extends Connection {
  private notifications = new NotificationService();

  private earnings = new PlatformEarningsService();

  // ---- Platform billing config (singleton) ------------------------------

  // Read the singleton config, creating it with defaults on first access.
  public async getBillingConfig(): Promise<BillingConfig> {
    return loadBillingConfig();
  }

  public async updateBillingConfig(input: Partial<BillingConfig>) {
    const existing = await this.platformConfig.findFirst();
    const id =
      existing?.id ?? (await this.platformConfig.create({ data: {} })).id;
    const clampPct = (n: unknown, fallback: number) => {
      const v = Number(n);
      return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : fallback;
    };
    const nonNeg = (n: unknown, fallback: number) => {
      const v = Number(n);
      return Number.isFinite(v) ? Math.max(0, v) : fallback;
    };
    const positive = (n: unknown, fallback: number) => {
      const v = Number(n);
      return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : fallback;
    };
    // Whole months a setup fee covers: at least 1, at most 24.
    const months = (n: unknown, fallback: number) => {
      const v = Number(n);
      return Number.isFinite(v)
        ? Math.min(24, Math.max(1, Math.round(v)))
        : fallback;
    };
    const current = await this.getBillingConfig();
    const standardMonthly = positive(
      input.priceStandardMonthly,
      current.priceStandardMonthly,
    );
    const premiumMonthly = positive(
      input.pricePremiumMonthly,
      current.pricePremiumMonthly,
    );
    const storefrontMonthly = positive(
      input.priceStorefrontMonthly,
      current.priceStorefrontMonthly,
    );
    const row = await this.platformConfig.update({
      where: { id },
      data: {
        revenueShareEnabled:
          typeof input.revenueShareEnabled === "boolean"
            ? input.revenueShareEnabled
            : current.revenueShareEnabled,
        commissionStandardPercent: clampPct(
          input.commissionStandardPercent,
          current.commissionStandardPercent,
        ),
        commissionPremiumPercent: clampPct(
          input.commissionPremiumPercent,
          current.commissionPremiumPercent,
        ),
        setupFeeStandard: nonNeg(
          input.setupFeeStandard,
          current.setupFeeStandard,
        ),
        setupFeePremium: nonNeg(input.setupFeePremium, current.setupFeePremium),
        setupFeeStorefront: nonNeg(
          input.setupFeeStorefront,
          current.setupFeeStorefront,
        ),
        commissionStorefrontPercent: clampPct(
          input.commissionStorefrontPercent,
          current.commissionStorefrontPercent,
        ),
        subscriptionSetupFeeStorefront: nonNeg(
          input.subscriptionSetupFeeStorefront,
          current.subscriptionSetupFeeStorefront,
        ),
        subscriptionSetupFeeStandard: nonNeg(
          input.subscriptionSetupFeeStandard,
          current.subscriptionSetupFeeStandard,
        ),
        subscriptionSetupFeePremium: nonNeg(
          input.subscriptionSetupFeePremium,
          current.subscriptionSetupFeePremium,
        ),
        setupFeeMonthsMonthly: months(
          input.setupFeeMonthsMonthly,
          current.setupFeeMonthsMonthly,
        ),
        setupFeeMonthsYearly: months(
          input.setupFeeMonthsYearly,
          current.setupFeeMonthsYearly,
        ),
        // A plan must cost something: 0 or blank keeps the current price.
        // Yearly prices are stored for reference but always follow monthly.
        priceStandardMonthly: standardMonthly,
        priceStandardYearly: yearlyFrom(standardMonthly),
        pricePremiumMonthly: premiumMonthly,
        pricePremiumYearly: yearlyFrom(premiumMonthly),
        priceStorefrontMonthly: storefrontMonthly,
        priceStorefrontYearly: yearlyFrom(storefrontMonthly),
        newStudioDiscountPercent: clampPct(
          input.newStudioDiscountPercent,
          current.newStudioDiscountPercent,
        ),
        newStudioDiscountMonths: months(
          input.newStudioDiscountMonths,
          current.newStudioDiscountMonths,
        ),
        reactivationFee: nonNeg(input.reactivationFee, current.reactivationFee),
      },
    });
    return { message: "Billing config updated", data: toBillingConfig(row) };
  }

  // ---- Listing / detail -------------------------------------------------

  /**
   * Every studio's id, name and address, for filter menus. Cheap on purpose:
   * the full listStudios() adds up every studio's payments and earnings, which
   * menus that only show names should not pay for on every page load.
   */
  public async listStudioOptions() {
    return this.studio.findMany({
      select: { id: true, name: true, slug: true },
      orderBy: { name: "asc" },
    });
  }

  /**
   * One page of studios for the super admin's table, newest first, optionally
   * of one status. Counts are only worked out for the studios on this page.
   */
  public async listStudios(page: CursorPage, status?: string) {
    const rows = await this.studio.findMany({
      ...(status === "ACTIVE" || status === "SUSPENDED" || status === "TRIAL"
        ? { where: { status } }
        : {}),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { settings: true },
      ...cursorPageArgs(page),
    });
    const { data: studios, pagination } = cursorPageResult(rows, page);
    const pageIds = studios.map((s) => s.id);

    // Owner emails in one query.
    const ownerIds = studios
      .map((s) => s.ownerUserId)
      .filter((id): id is string => Boolean(id));
    const owners = ownerIds.length
      ? await this.user.findMany({
          where: { id: { in: ownerIds } },
          select: { id: true, email: true },
        })
      : [];
    const ownerEmailById = new Map(owners.map((o) => [o.id, o.email]));

    // Per-studio member + booking counts (unscoped groupBy under superAdmin).
    const userCounts = await this.user.groupBy({
      by: ["studioId"],
      where: { studioId: { in: pageIds } },
      _count: { _all: true },
    });
    const apptCounts = await this.appointment.groupBy({
      by: ["studioId"],
      where: { studioId: { in: pageIds } },
      _count: { _all: true },
    });
    const countBy = (
      rows: Array<{ studioId: string | null; _count: { _all: number } }>,
    ) => {
      const m = new Map<string, number>();
      for (const r of rows) if (r.studioId) m.set(r.studioId, r._count._all);
      return m;
    };
    const usersByStudio = countBy(userCounts);
    const apptsByStudio = countBy(apptCounts);

    // What customers paid each studio (after refunds), all time and this
    // month, and what each studio has paid the platform.
    const now = new Date();
    const thisMonth = {
      from: new Date(now.getFullYear(), now.getMonth(), 1),
      to: now,
    };
    const [allPay, monthPay] = await Promise.all([
      this.earnings.customerPaymentsByStudio(),
      this.earnings.customerPaymentsByStudio(thisMonth),
    ]);
    const earned = await this.earnings.platformEarningsByStudio(
      studios,
      allPay.total,
    );
    const r2 = (n: number | undefined) => Math.round((n ?? 0) * 100) / 100;

    const data = studios.map((s) => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      status: s.status,
      plan: s.plan,
      billingCadence: s.billingCadence,
      subscriptionStatus: s.subscriptionStatus,
      currentPeriodEnd: s.currentPeriodEnd,
      customDomain: s.customDomain,
      ownerEmail: s.ownerUserId
        ? (ownerEmailById.get(s.ownerUserId) ?? null)
        : null,
      userCount: usersByStudio.get(s.id) ?? 0,
      appointmentCount: apptsByStudio.get(s.id) ?? 0,
      revenue: r2(allPay.total.get(s.id)),
      revenueThisMonth: r2(monthPay.total.get(s.id)),
      paidToPlatform: r2(earned.total.get(s.id)),
      billingMode: s.billingMode,
      platformFeePercent: s.platformFeePercent,
      settings: s.settings,
      createdAt: s.createdAt,
    }));
    return { data, pagination };
  }

  // ---- Earnings (lives in platform/platformEarningsService) ------------

  public listEarnings(
    ...args: Parameters<PlatformEarningsService["listEarnings"]>
  ) {
    return this.earnings.listEarnings(...args);
  }

  public platformEarningEntries(
    ...args: Parameters<PlatformEarningsService["platformEarningEntries"]>
  ) {
    return this.earnings.platformEarningEntries(...args);
  }

  /**
   * The public directory of businesses on Zuri: every active studio and store,
   * with what customers need to choose one. Optional search over name, area
   * and services, and a filter for studios or stores.
   */
  public async getDirectory(q: unknown, kind: unknown, page: CursorPage) {
    const studios = await this.studio.findMany({
      where: { status: "ACTIVE" },
      select: {
        id: true,
        name: true,
        slug: true,
        shopCategory: true,
        shopCategories: true,
        settings: { select: { booking: true, commerce: true } },
        branding: { select: { logoUrl: true } },
        content: {
          select: { heroImageUrl: true, aboutText: true, studioTypes: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    const ids = studios.map((s) => s.id);
    const [contacts, services, ratings, images, categories] = await Promise.all(
      [
        this.contactInfo.findMany({
          where: { studioId: { in: ids } },
          select: { studioId: true, address: true },
        }),
        this.service.findMany({
          where: { studioId: { in: ids }, active: true },
          select: { studioId: true, name: true, popular: true },
        }),
        this.review.groupBy({
          by: ["studioId"],
          where: { studioId: { in: ids }, approved: true },
          _avg: { rating: true },
          _count: { _all: true },
        }),
        // A photo for businesses without a hero image: their newest product or gallery shot.
        this.product.findMany({
          where: {
            studioId: { in: ids },
            active: true,
            imageUrl: { not: null },
          },
          select: { studioId: true, imageUrl: true },
          orderBy: { createdAt: "desc" },
        }),
        // A shop's tags are its product categories.
        this.productCategory.findMany({
          where: { studioId: { in: ids }, active: true },
          select: { studioId: true, name: true },
          orderBy: { order: "asc" },
        }),
      ],
    );
    const s3 = new S3BucketService();
    // Searches start at 3 characters; shorter is treated as no search.
    const raw =
      typeof q === "string" ? q.trim().toLowerCase().slice(0, 80) : "";
    const query = raw.length >= 3 ? raw : "";
    const data = studios
      .map((st) => {
        const booking = st.settings?.booking !== false;
        const own = services.filter((x) => x.studioId === st.id);
        const top = booking
          ? [...own]
              .sort((a, b) => Number(b.popular) - Number(a.popular))
              .slice(0, 3)
              .map((x) => x.name)
          : categories
              .filter((c) => c.studioId === st.id)
              .slice(0, 3)
              .map((c) => c.name);
        const rating = ratings.find((r) => r.studioId === st.id);
        const photo =
          st.content?.heroImageUrl ??
          images.find((i) => i.studioId === st.id)?.imageUrl ??
          null;
        return {
          name: st.name,
          slug: st.slug,
          kind: booking ? ("studio" as const) : ("store" as const),
          shopCategory: st.shopCategory,
          shopCategories: st.shopCategories,
          area: contacts.find((c) => c.studioId === st.id)?.address ?? null,
          about: st.content?.aboutText?.slice(0, 160) ?? null,
          logoUrl: s3.deliveryUrl(st.branding?.logoUrl ?? null),
          photoUrl: s3.deliveryUrl(photo),
          topServices: top,
          rating: rating?._avg.rating ?? null,
          reviews: rating?._count._all ?? 0,
          searchText: [
            st.name,
            contacts.find((c) => c.studioId === st.id)?.address ?? "",
            ...own.map((x) => x.name),
            ...categories
              .filter((c) => c.studioId === st.id)
              .map((c) => c.name),
            st.shopCategory ?? "",
            ...st.shopCategories,
            ...(st.content?.studioTypes ?? []).map((t) => t.replace(/-/g, " ")),
          ]
            .join(" ")
            .toLowerCase(),
        };
      })
      .filter((d) =>
        kind === "studio" || kind === "store" ? d.kind === kind : true,
      )
      .filter(
        (d) =>
          !query || query.split(/\s+/).every((w) => d.searchText.includes(w)),
      )
      .map(({ searchText: _searchText, ...rest }) => rest);
    // Paged after the search: the cursor is the offset into the results.
    const offset = Math.max(0, Number(page.cursor ?? 0) || 0);
    const slice = data.slice(offset, offset + page.limit);
    const hasMore = offset + page.limit < data.length;
    return {
      message: "Directory",
      data: slice,
      pagination: {
        limit: page.limit,
        hasMore,
        nextCursor: hasMore ? String(offset + page.limit) : null,
        total: data.length,
      },
    };
  }

  /**
   * Public figures for the platform's landing page (shown as they are).
   */
  public async getPublicStats() {
    const [studios, bookings, customers, orders] = await Promise.all([
      this.studio.count({ where: { status: "ACTIVE" } }),
      this.appointment.count({
        where: { status: { in: ["CONFIRMED", "COMPLETED"] } },
      }),
      this.user.count({ where: { role: "CUSTOMER" } }),
      // Shop orders customers paid for (and those already handed over).
      this.order.count({ where: { status: { in: [...PAID_ORDER_STATUSES] } } }),
    ]);
    return {
      studiosLive: studios,
      bookingsMade: bookings,
      customers,
      ordersPlaced: orders,
    };
  }

  // Platform-wide figures for the super-admin dashboard. Two kinds of money,
  // kept apart because they're easy to confuse: what customers paid studios,
  // and what studios paid the platform.
  public async getAnalytics() {
    const now = new Date();
    const thisMonth = {
      from: new Date(now.getFullYear(), now.getMonth(), 1),
      to: now,
    };
    const lastMonth = {
      from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      to: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999),
    };

    const [studios, userRoles, newUsers] = await Promise.all([
      this.studio.findMany({
        select: {
          id: true,
          status: true,
          billingMode: true,
          platformFeePercent: true,
          createdAt: true,
        },
      }),
      this.user.groupBy({ by: ["role"], _count: { _all: true } }),
      this.user.count({
        where: {
          role: { in: ["CUSTOMER", "ADMIN"] },
          createdAt: { gte: thisMonth.from },
        },
      }),
    ]);

    const [allPay, nowPay, prevPay] = await Promise.all([
      this.earnings.customerPaymentsByStudio(),
      this.earnings.customerPaymentsByStudio(thisMonth),
      this.earnings.customerPaymentsByStudio(lastMonth),
    ]);
    const [allEarn, nowEarn, prevEarn] = await Promise.all([
      this.earnings.platformEarningsByStudio(studios, allPay.total),
      this.earnings.platformEarningsByStudio(studios, nowPay.total, thisMonth),
      this.earnings.platformEarningsByStudio(studios, prevPay.total, lastMonth),
    ]);

    const sum = (m: Map<string, number>) => {
      let t = 0;
      for (const v of m.values()) t += v;
      return Math.round(t * 100) / 100;
    };
    const roleCount = (r: string) =>
      userRoles.find((u) => u.role === r)?._count._all ?? 0;
    const customers = roleCount("CUSTOMER");
    const admins = roleCount("ADMIN");

    return {
      message: "Platform analytics",
      data: {
        // Kept for older screens.
        totalStudios: studios.length,
        activeStudios: studios.filter((s) => s.status === "ACTIVE").length,
        suspendedStudios: studios.filter((s) => s.status === "SUSPENDED")
          .length,
        trialStudios: studios.filter((s) => s.status === "TRIAL").length,
        totalUsers: customers + admins,
        totalRevenue: sum(allPay.total),

        studios: {
          total: studios.length,
          active: studios.filter((s) => s.status === "ACTIVE").length,
          suspended: studios.filter((s) => s.status === "SUSPENDED").length,
          trial: studios.filter((s) => s.status === "TRIAL").length,
          subscription: studios.filter((s) => s.billingMode === "SUBSCRIPTION")
            .length,
          revenueShare: studios.filter((s) => s.billingMode === "REVENUE_SHARE")
            .length,
          newThisMonth: studios.filter((s) => s.createdAt >= thisMonth.from)
            .length,
        },
        users: { customers, studioAdmins: admins, newThisMonth: newUsers },
        customerPayments: {
          allTime: sum(allPay.total),
          thisMonth: sum(nowPay.total),
          lastMonth: sum(prevPay.total),
          bookingsAllTime: sum(allPay.bookings),
          ordersAllTime: sum(allPay.products),
        },
        platformEarnings: {
          allTime: sum(allEarn.total),
          thisMonth: sum(nowEarn.total),
          lastMonth: sum(prevEarn.total),
          setupFeesAllTime: sum(allEarn.setupFees),
          renewalsAllTime: sum(allEarn.renewals),
          commissionsAllTime: sum(allEarn.commissions),
        },
      },
    };
  }

  public async getStudio(id: string) {
    const studio = await this.studio.findUnique({
      where: { id },
      include: { settings: true, branding: true, content: true },
    });
    if (!studio) {
      throw new ApiError("Studio not found", HttpCode.NOT_FOUND);
    }

    const owner = studio.ownerUserId
      ? await this.user.findUnique({
          where: { id: studio.ownerUserId },
          select: { id: true, email: true, role: true },
        })
      : null;

    const [
      userCount,
      appointmentCount,
      serviceCount,
      orderCount,
      productCount,
    ] = await Promise.all([
      this.user.count({ where: { studioId: id } }),
      this.appointment.count({ where: { studioId: id } }),
      this.service.count({ where: { studioId: id } }),
      this.order.count({ where: { studioId: id } }),
      this.product.count({ where: { studioId: id } }),
    ]);

    // Plan, period and what this studio has paid the platform.
    const [signup, earnings] = await Promise.all([
      this.studioSignup.findFirst({
        where: { studioId: id, status: "PROVISIONED" },
        orderBy: { createdAt: "desc" },
        select: {
          reference: true,
          amountCharged: true,
          setupFeeCharged: true,
          coverageMonths: true,
          updatedAt: true,
        },
      }),
      this.earnings.platformEarningEntries({ studioId: id }),
    ]);
    const subscription = studio.billingMode === "SUBSCRIPTION";
    const end = studio.currentPeriodEnd;
    const lapsed = subscription ? isLapsed(end) : false;
    const lastPayment =
      earnings.find((e) => e.purpose !== "COMMISSION") ?? null;
    const billing = {
      mode: studio.billingMode,
      plan: studio.plan,
      cadence: studio.billingCadence,
      status: subscription ? (lapsed ? "lapsed" : "active") : "revenue_share",
      commissionPercent: subscription ? null : studio.platformFeePercent,
      currentPeriodEnd: end,
      // When the paid period began: the last renewal/plan change, else signup.
      currentPeriodStart: subscription
        ? (earnings.find(
            (e) => e.purpose === "RENEWAL" || e.purpose === "PLAN_CHANGE",
          )?.date ?? studio.createdAt)
        : null,
      daysLeft:
        subscription && end
          ? Math.ceil((end.getTime() - Date.now()) / 86_400_000)
          : null,
      signup: signup
        ? {
            reference: signup.reference,
            amount: signup.amountCharged ?? 0,
            setupFee: signup.setupFeeCharged,
            coverageMonths: signup.coverageMonths,
            date: signup.updatedAt,
          }
        : null,
      lastPayment,
      // What this customer pays per period now, after its own terms.
      yourPrice: studioPriceFor(
        studio,
        studio.plan as Plan,
        studio.billingCadence as "MONTHLY" | "YEARLY",
        await loadBillingConfig(),
      ),
      terms: {
        customPriceMonthly: studio.customPriceMonthly,
        discountPercent: studio.billingDiscountPercent,
        discountEndsAt: studio.billingDiscountEndsAt,
        note: studio.billingNote,
      },
      totalPaid:
        Math.round(earnings.reduce((t, e) => t + e.amount, 0) * 100) / 100,
      payments: earnings,
    };

    return {
      ...studio,
      owner,
      counts: {
        userCount,
        appointmentCount,
        serviceCount,
        orderCount,
        productCount,
      },
      billing,
    };
  }

  // ---- Provisioning -----------------------------------------------------

  // Super-admin manual provisioning (bypasses payment). Validates input, hashes
  // the password, then delegates to the shared core.
  public async provisionStudio(input: ProvisionStudioInput) {
    const name = String(input.name ?? "").trim();
    if (name.length < 2 || name.length > 60) {
      throw new ApiError(
        "Studio name must be 2-60 characters",
        HttpCode.BAD_REQUEST,
      );
    }
    const slug = validateStudioSlug(input.slug);
    const ownerEmail = String(input.ownerEmail ?? "")
      .trim()
      .toLowerCase();
    if (!EMAIL_RE.test(ownerEmail)) {
      throw new ApiError(
        "A valid owner email is required",
        HttpCode.BAD_REQUEST,
      );
    }
    const ownerPassword = String(input.ownerPassword ?? "");
    if (ownerPassword.length < 8) {
      throw new ApiError(
        "Owner password must be at least 8 characters",
        HttpCode.BAD_REQUEST,
      );
    }
    const ownerPasswordHash = await getPasswordHash(ownerPassword);

    return this.provisionStudioCore({
      name,
      slug,
      ownerEmail,
      ownerPasswordHash,
      ...(input.ownerFullName ? { ownerFullName: input.ownerFullName } : {}),
      ...(input.customDomain ? { customDomain: input.customDomain } : {}),
      plan: input.plan ?? "STANDARD",
      ...(input.settings ? { settingsOverride: input.settings } : {}),
    });
  }

  /**
   * Shared studio creation used by both super-admin provisioning and paid
   * self-serve onboarding. MUST run in the super-admin tenant context (so the
   * scoped models — user/profile — take the explicit studioId, not the caller's
   * studio). Callers that aren't already super-admin wrap this in runAsSuperAdmin.
   */
  public async provisionStudioCore(input: ProvisionCoreInput) {
    // Slug uniqueness (globally unique in the schema).
    const slugTaken = await this.studio.findUnique({
      where: { slug: input.slug },
    });
    if (slugTaken) {
      throw new ApiError(
        "A studio with that slug already exists",
        HttpCode.CONFLICT,
      );
    }

    const customDomain = input.customDomain?.trim().toLowerCase() || undefined;
    if (customDomain) {
      const domainTaken = await this.studio.findFirst({
        where: { customDomain },
      });
      if (domainTaken) {
        throw new ApiError(
          "That custom domain is already in use",
          HttpCode.CONFLICT,
        );
      }
    }

    const sub = input.subscription;
    const studio = await this.studio.create({
      data: {
        name: input.name,
        slug: input.slug,
        status: "ACTIVE",
        plan: input.plan,
        ...(input.cadence ? { billingCadence: input.cadence } : {}),
        ...(input.billingMode ? { billingMode: input.billingMode } : {}),
        ...(input.shopCategory ? { shopCategory: input.shopCategory } : {}),
        ...(input.shopCategories?.length
          ? { shopCategories: input.shopCategories }
          : input.shopCategory
            ? { shopCategories: [input.shopCategory] }
            : {}),
        ...(input.platformFeePercent !== undefined
          ? { platformFeePercent: input.platformFeePercent }
          : {}),
        ...(sub?.customerCode
          ? { paystackCustomerCode: sub.customerCode }
          : {}),
        ...(sub?.subscriptionCode
          ? { subscriptionCode: sub.subscriptionCode }
          : {}),
        ...(sub?.status ? { subscriptionStatus: sub.status } : {}),
        ...(sub?.currentPeriodEnd
          ? { currentPeriodEnd: sub.currentPeriodEnd }
          : {}),
        ...(customDomain ? { customDomain } : {}),
        ...(input.welcomeDiscount && input.welcomeDiscount.percent > 0
          ? {
              billingDiscountPercent: input.welcomeDiscount.percent,
              billingDiscountEndsAt: addMonths(
                new Date(),
                input.welcomeDiscount.months,
              ),
            }
          : {}),
      },
    });

    const owner = await this.user.create({
      data: {
        email: input.ownerEmail,
        password: input.ownerPasswordHash,
        ...(input.ownerEmailVerified ? { emailVerifiedAt: new Date() } : {}),
        role: "ADMIN",
        studioId: studio.id,
      },
    });

    const ownerFullName = input.ownerFullName?.trim();
    await this.profile.create({
      data: {
        userId: owner.id,
        email: input.ownerEmail,
        studioId: studio.id,
        ...(ownerFullName ? { fullName: ownerFullName } : {}),
      },
    });

    await this.studio.update({
      where: { id: studio.id },
      data: { ownerUserId: owner.id },
    });

    // Feature flags from the plan, with any explicit override on top.
    const flags = {
      ...planFlags(input.plan),
      ...(input.settingsOverride ?? {}),
    };
    await this.studioSettings.create({
      data: { studioId: studio.id, ...flags },
    });
    await this.studioBranding.create({ data: { studioId: studio.id } });
    await this.studioContent.create({
      data: {
        studioId: studio.id,
        heroHeadline: input.name,
        showTestimonials: true,
        ...(input.studioTypes?.length
          ? {
              studioType: input.studioTypes[0]!,
              studioTypes: input.studioTypes,
            }
          : {}),
      },
    });

    return this.getStudio(studio.id);
  }

  // ---- Mutations --------------------------------------------------------

  public async updateStudio(
    id: string,
    data: {
      name?: string;
      customDomain?: string | null;
      platformFeePercent?: number;
    },
  ) {
    const studio = await this.studio.findUnique({ where: { id } });
    if (!studio) throw new ApiError("Studio not found", HttpCode.NOT_FOUND);

    const patch: {
      name?: string;
      customDomain?: string | null;
      platformFeePercent?: number;
    } = {};

    if (data.platformFeePercent !== undefined) {
      const pct = Number(data.platformFeePercent);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        throw new ApiError(
          "Fee must be between 0 and 100",
          HttpCode.BAD_REQUEST,
        );
      }
      patch.platformFeePercent = pct;
      // Keep Paystack in sync when the studio already has a subaccount.
      if (studio.paystackSubaccountCode) {
        try {
          await paystack.updateSubaccount(studio.paystackSubaccountCode, {
            percentageCharge: pct,
          });
        } catch (error) {
          throw new ApiError(
            error instanceof ApiError
              ? `Paystack: ${error.message}`
              : "Could not update the studio's fee on Paystack",
            HttpCode.BAD_GATEWAY,
          );
        }
      }
    }

    if (data.name !== undefined) {
      const name = String(data.name).trim();
      if (name.length < 2 || name.length > 60) {
        throw new ApiError(
          "Studio name must be 2-60 characters",
          HttpCode.BAD_REQUEST,
        );
      }
      patch.name = name;
    }

    if (data.customDomain !== undefined) {
      const domain = data.customDomain
        ? String(data.customDomain).trim().toLowerCase()
        : null;
      if (domain) {
        const taken = await this.studio.findFirst({
          where: { customDomain: domain, id: { not: id } },
        });
        if (taken) {
          throw new ApiError(
            "That custom domain is already in use",
            HttpCode.CONFLICT,
          );
        }
      }
      patch.customDomain = domain;
    }

    const updated = await this.studio.update({ where: { id }, data: patch });
    forgetStudioSlug(updated.slug);
    return this.getStudio(id);
  }

  public async setStatus(id: string, status: StudioStatus) {
    if (!["ACTIVE", "SUSPENDED", "TRIAL"].includes(status)) {
      throw new ApiError("Invalid status", HttpCode.BAD_REQUEST);
    }
    const studio = await this.studio.findUnique({ where: { id } });
    if (!studio) throw new ApiError("Studio not found", HttpCode.NOT_FOUND);

    await this.studio.update({ where: { id }, data: { status } });
    // Bust the resolver cache so the new status takes effect immediately.
    forgetStudioSlug(studio.slug);

    if (
      status === "SUSPENDED" &&
      studio.status !== "SUSPENDED" &&
      studio.ownerUserId
    ) {
      try {
        const owner = await this.user.findUnique({
          where: { id: studio.ownerUserId },
          select: { email: true },
        });
        if (owner?.email) {
          const { subject, html } = studioAccountSuspended(
            platformBrandForPlan(studio.plan),
            {
              studioName: studio.name,
              supportEmail: env.platformEmail,
              reactivationFee: (await this.getBillingConfig()).reactivationFee,
            },
          );
          await this.notifications.send({
            template: NotificationTemplate.STUDIO_ACCOUNT_SUSPENDED,
            to: owner.email,
            subject,
            html,
            studioId: studio.id,
            entityType: "Studio",
            entityId: `${studio.id}:${status}:${Date.now()}`,
          });
        }
      } catch (error) {
        console.error("Failed to send studio-suspended email:", error);
      }
    }

    return this.getStudio(id);
  }

  // Permanently delete a studio and ALL of its data. Irreversible. Runs against
  // the raw (unscoped) client, deleting every tenant-scoped collection by
  // studioId plus the studio's own branding/content/settings/signup rows, then
  // the studio itself. Audit logs are kept as an immutable record.
  public async deleteStudio(id: string) {
    const studio = await this.studio.findUnique({ where: { id } });
    if (!studio) throw new ApiError("Studio not found", HttpCode.NOT_FOUND);

    const where = { studioId: id };
    // Order doesn't matter in MongoDB (no FK constraints); child rows carry the
    // studioId discriminator too (injected by the tenant extension on create).
    await Promise.all([
      this.raw.cartItem.deleteMany({ where }),
      this.raw.cart.deleteMany({ where }),
      this.raw.orderItem.deleteMany({ where }),
      this.raw.order.deleteMany({ where }),
      this.raw.referralOrderReward.deleteMany({ where }),
      this.raw.payment.deleteMany({ where }),
      this.raw.appointment.deleteMany({ where }),
      this.raw.serviceAddOn.deleteMany({ where }),
      this.raw.service.deleteMany({ where }),
      this.raw.review.deleteMany({ where }),
      this.raw.gallery.deleteMany({ where }),
      this.raw.category.deleteMany({ where }),
      this.raw.productCategory.deleteMany({ where }),
      this.raw.product.deleteMany({ where }),
      this.raw.businessHours.deleteMany({ where }),
      this.raw.blockedDate.deleteMany({ where }),
      this.raw.contactInfo.deleteMany({ where }),
      this.raw.loyaltyTransaction.deleteMany({ where }),
      this.raw.loyaltyPoints.deleteMany({ where }),
      this.raw.referral.deleteMany({ where }),
      this.raw.referralCode.deleteMany({ where }),
      this.raw.commerceSettings.deleteMany({ where }),
      this.raw.paymentSettings.deleteMany({ where }),
      this.raw.promoBanner.deleteMany({ where }),
      this.raw.profile.deleteMany({ where }),
      this.raw.featureRequest.deleteMany({ where }),
      this.raw.studioBranding.deleteMany({ where }),
      this.raw.studioContent.deleteMany({ where }),
      this.raw.studioSettings.deleteMany({ where }),
      this.raw.studioSignup.deleteMany({ where }),
    ]);
    // Users last (owner + any staff/customers of this studio).
    await revokeStudioLoginSessions(id);
    await this.raw.user.deleteMany({ where });
    await this.raw.studio.delete({ where: { id } });

    forgetStudioSlug(studio.slug);
    return { message: "Studio deleted", data: { id, slug: studio.slug } };
  }

  public async updateSettings(id: string, settings: StudioSettingsInput) {
    const studio = await this.studio.findUnique({ where: { id } });
    if (!studio) throw new ApiError("Studio not found", HttpCode.NOT_FOUND);

    const patch = Object.fromEntries(
      Object.entries(settings).filter(
        ([k, v]) =>
          typeof v === "boolean" &&
          [
            "booking",
            "commerce",
            "loyalty",
            "referrals",
            "reviews",
            "gallery",
            "onlinePayments",
            "productsInBooking",
          ].includes(k),
      ),
    );

    await this.studioSettings.upsert({
      where: { studioId: id },
      update: patch,
      create: { studioId: id, ...patch },
    });
    return this.getStudio(id);
  }

  // ---- Impersonation ----------------------------------------------------

  /**
   * Mint an access token for the studio's owner so the super admin can drop into
   * that studio's admin dashboard. The frontend uses the returned slug to scope
   * subsequent requests to the studio.
   */
  /**
   * Send a studio admin a password-reset link, on behalf of a super admin who
   * was asked for help getting back in.
   *
   * Note this does NOT reveal the existing password: passwords are bcrypt
   * hashes (see utils/helper.getPasswordHash), which are one-way — the original
   * is not stored anywhere and cannot be recovered by us or by anyone else.
   * A reset is the only way back in, and it keeps the super admin out of the
   * business of handling someone else's credentials.
   *
   * The reset link goes to the studio admin's own email, never back in the API
   * response, so a compromised super-admin session cannot take over a studio
   * without also holding that mailbox. Every use is recorded in the audit log.
   */
  public async sendStudioAdminPasswordReset(
    studioId: string,
    actor: { id?: string | null; email?: string; role?: string },
    targetUserId?: string,
  ) {
    const studio = await this.studio.findUnique({ where: { id: studioId } });
    if (!studio) throw new ApiError("Studio not found", HttpCode.NOT_FOUND);

    // Default to the studio owner; allow naming another admin on that studio.
    const where = targetUserId
      ? { id: targetUserId }
      : studio.ownerUserId
        ? { id: studio.ownerUserId }
        : null;
    if (!where) {
      throw new ApiError(
        "This studio has no owner account to reset",
        HttpCode.BAD_REQUEST,
      );
    }

    const user = await this.user.findUnique({
      where,
      select: { id: true, email: true, role: true, studioId: true },
    });
    if (!user) throw new ApiError("Account not found", HttpCode.NOT_FOUND);

    // Guard against resetting an account that isn't an admin of THIS studio —
    // a super admin helping studio A must not be able to aim this at a
    // customer, or at an admin of studio B, by passing an arbitrary id.
    if (user.studioId !== studioId) {
      throw new ApiError(
        "That account does not belong to this studio",
        HttpCode.FORBIDDEN,
      );
    }
    if (user.role !== "ADMIN") {
      throw new ApiError(
        "Only a studio admin account can be reset here",
        HttpCode.FORBIDDEN,
      );
    }

    const resetToken = randomBytes(32).toString("hex");
    const hashedToken = createHash("sha256").update(resetToken).digest("hex");
    const expiry = new Date(Date.now() + 60 * 60 * 1000);
    await this.user.update({
      where: { id: user.id },
      data: { resetToken: hashedToken, resetTokenExpiry: expiry },
    });

    const resetUrl = await this.linkToStudio(
      `/reset-password/${resetToken}`,
      studioId,
    );
    try {
      const brand = await this.studioEmailBrand(studioId, platformBrand);
      const { subject, html } = passwordResetRequested(brand, {
        resetUrl,
        expiresInMinutes: 60,
      });
      await this.notifications.send({
        template: NotificationTemplate.AUTH_PASSWORD_RESET_REQUESTED,
        to: user.email,
        subject,
        html,
        studioId,
        entityType: "User",
        entityId: hashedToken,
      });
    } catch {
      // Don't leave a live token behind if the mail couldn't be queued.
      await this.user.update({
        where: { id: user.id },
        data: { resetToken: "", resetTokenExpiry: new Date(0) },
      });
      throw new ApiError(
        "Couldn't send the reset email. Please try again.",
        HttpCode.INTERNAL_SERVER_ERROR,
      );
    }

    await new AuditService().record({
      actor,
      action: "studio.admin.password_reset_sent",
      targetType: "User",
      targetId: user.id,
      studioId,
      metadata: {
        studioSlug: studio.slug,
        sentToEmail: user.email,
        expiresAt: expiry.toISOString(),
      },
    });

    return {
      message: `A password reset link has been sent to ${user.email}. It expires in 1 hour.`,
      data: { email: user.email, expiresAt: expiry },
    };
  }

  public async impersonate(id: string) {
    const studio = await this.studio.findUnique({ where: { id } });
    if (!studio) throw new ApiError("Studio not found", HttpCode.NOT_FOUND);
    if (!studio.ownerUserId) {
      throw new ApiError(
        "This studio has no owner to impersonate",
        HttpCode.BAD_REQUEST,
      );
    }

    const owner = await this.user.findUnique({
      where: { id: studio.ownerUserId },
      select: { id: true, email: true, role: true, studioId: true },
    });
    if (!owner) {
      throw new ApiError("Studio owner not found", HttpCode.NOT_FOUND);
    }

    const { token } = await createLoginSession({
      id: owner.id,
      email: owner.email,
      role: owner.role,
      studioId: studio.id,
    });

    return {
      token,
      studio: { id: studio.id, slug: studio.slug, name: studio.name },
      user: { id: owner.id, email: owner.email, role: owner.role },
    };
  }
}
