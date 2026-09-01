import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import { HttpCode } from "../models/status_codes";
import { getPasswordHash, loginToken } from "../utils/helper";
import { forgetStudioSlug } from "../tenant/studioResolver";
import { paystack } from "../payment/paystackClient";

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
  String(raw ?? "").trim().toLowerCase();

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

type Plan = "STANDARD" | "PREMIUM";

// Feature flags a plan unlocks. Booking is always on; Premium adds the shop.
export const planFlags = (plan: Plan) => ({
  commerce: plan === "PREMIUM",
  productsInBooking: plan === "PREMIUM",
  onlinePayments: true, // online booking payments are in both plans
  loyalty: true,
  referrals: true,
  reviews: true,
  gallery: true,
});

export interface BillingConfig {
  revenueShareEnabled: boolean;
  commissionStandardPercent: number;
  commissionPremiumPercent: number;
  setupFeeStandard: number;
  setupFeePremium: number;
}

// Commission % the platform takes per transaction for a plan (REVENUE_SHARE).
export const commissionFor = (plan: Plan, cfg: BillingConfig): number =>
  plan === "PREMIUM" ? cfg.commissionPremiumPercent : cfg.commissionStandardPercent;

// One-time setup fee (GHS) charged at signup for a plan (REVENUE_SHARE).
export const setupFeeFor = (plan: Plan, cfg: BillingConfig): number =>
  plan === "PREMIUM" ? cfg.setupFeePremium : cfg.setupFeeStandard;

export interface StudioSettingsInput {
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
  ownerFullName?: string;
  customDomain?: string;
  plan: Plan;
  cadence?: "MONTHLY" | "YEARLY";
  billingMode?: "SUBSCRIPTION" | "REVENUE_SHARE";
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
}

type StudioStatus = "ACTIVE" | "SUSPENDED" | "TRIAL";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Super-admin operations that span studios. Every method here runs inside the
 * platform (superAdmin) tenant context, so the tenant extension is bypassed and
 * studioId must be set explicitly on the documents we create.
 */
export class PlatformService extends Connection {
  // ---- Platform billing config (singleton) ------------------------------

  // Read the singleton config, creating it with defaults on first access.
  public async getBillingConfig(): Promise<BillingConfig> {
    const existing = await this.platformConfig.findFirst();
    const row = existing ?? (await this.platformConfig.create({ data: {} }));
    return {
      revenueShareEnabled: row.revenueShareEnabled,
      commissionStandardPercent: row.commissionStandardPercent,
      commissionPremiumPercent: row.commissionPremiumPercent,
      setupFeeStandard: row.setupFeeStandard,
      setupFeePremium: row.setupFeePremium,
    };
  }

  public async updateBillingConfig(input: Partial<BillingConfig>) {
    const existing = await this.platformConfig.findFirst();
    const id = existing?.id ?? (await this.platformConfig.create({ data: {} })).id;
    const clampPct = (n: unknown, fallback: number) => {
      const v = Number(n);
      return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : fallback;
    };
    const nonNeg = (n: unknown, fallback: number) => {
      const v = Number(n);
      return Number.isFinite(v) ? Math.max(0, v) : fallback;
    };
    const current = await this.getBillingConfig();
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
        setupFeeStandard: nonNeg(input.setupFeeStandard, current.setupFeeStandard),
        setupFeePremium: nonNeg(input.setupFeePremium, current.setupFeePremium),
      },
    });
    return {
      message: "Billing config updated",
      data: {
        revenueShareEnabled: row.revenueShareEnabled,
        commissionStandardPercent: row.commissionStandardPercent,
        commissionPremiumPercent: row.commissionPremiumPercent,
        setupFeeStandard: row.setupFeeStandard,
        setupFeePremium: row.setupFeePremium,
      },
    };
  }

  // ---- Listing / detail -------------------------------------------------

  public async listStudios() {
    const studios = await this.studio.findMany({
      orderBy: { createdAt: "desc" },
      include: { settings: true },
    });

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
      _count: { _all: true },
    });
    const apptCounts = await this.appointment.groupBy({
      by: ["studioId"],
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

    // Revenue = paid booking payments + paid/fulfilled product orders, per studio.
    const revenueByStudio = await this.revenueByStudio();

    return studios.map((s) => ({
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
        ? ownerEmailById.get(s.ownerUserId) ?? null
        : null,
      userCount: usersByStudio.get(s.id) ?? 0,
      appointmentCount: apptsByStudio.get(s.id) ?? 0,
      revenue: revenueByStudio.get(s.id) ?? 0,
      settings: s.settings,
      createdAt: s.createdAt,
    }));
  }

  // Paid GMV per studio (booking payments + product orders), rounded to 2dp.
  private async revenueByStudio(): Promise<Map<string, number>> {
    const [payments, orders] = await Promise.all([
      this.payment.groupBy({
        by: ["studioId"],
        where: { status: "PAID" },
        _sum: { amount: true },
      }),
      this.order.groupBy({
        by: ["studioId"],
        where: { status: { in: ["PAID", "FULFILLED"] } },
        _sum: { total: true },
      }),
    ]);
    const m = new Map<string, number>();
    for (const p of payments) {
      if (p.studioId) m.set(p.studioId, (m.get(p.studioId) ?? 0) + (p._sum.amount ?? 0));
    }
    for (const o of orders) {
      if (o.studioId) m.set(o.studioId, (m.get(o.studioId) ?? 0) + (o._sum.total ?? 0));
    }
    for (const [k, v] of m) m.set(k, Math.round(v * 100) / 100);
    return m;
  }

  // Platform-wide totals for the super-admin dashboard.
  public async getAnalytics() {
    const [studios, totalUsers] = await Promise.all([
      this.studio.findMany({ select: { id: true, status: true } }),
      this.user.count(),
    ]);
    const revenueByStudio = await this.revenueByStudio();
    let totalRevenue = 0;
    for (const v of revenueByStudio.values()) totalRevenue += v;

    const active = studios.filter((s) => s.status === "ACTIVE").length;
    const suspended = studios.filter((s) => s.status === "SUSPENDED").length;
    const trial = studios.filter((s) => s.status === "TRIAL").length;

    return {
      message: "Platform analytics",
      data: {
        totalStudios: studios.length,
        activeStudios: active,
        suspendedStudios: suspended,
        trialStudios: trial,
        totalUsers,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
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

    const [userCount, appointmentCount, serviceCount, orderCount] =
      await Promise.all([
        this.user.count({ where: { studioId: id } }),
        this.appointment.count({ where: { studioId: id } }),
        this.service.count({ where: { studioId: id } }),
        this.order.count({ where: { studioId: id } }),
      ]);

    return {
      ...studio,
      owner,
      counts: { userCount, appointmentCount, serviceCount, orderCount },
    };
  }

  // ---- Provisioning -----------------------------------------------------

  // Super-admin manual provisioning (bypasses payment). Validates input, hashes
  // the password, then delegates to the shared core.
  public async provisionStudio(input: ProvisionStudioInput) {
    const name = String(input.name ?? "").trim();
    if (name.length < 2 || name.length > 60) {
      throw new ApiError("Studio name must be 2-60 characters", HttpCode.BAD_REQUEST);
    }
    const slug = validateStudioSlug(input.slug);
    const ownerEmail = String(input.ownerEmail ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(ownerEmail)) {
      throw new ApiError("A valid owner email is required", HttpCode.BAD_REQUEST);
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
    const slugTaken = await this.studio.findUnique({ where: { slug: input.slug } });
    if (slugTaken) {
      throw new ApiError("A studio with that slug already exists", HttpCode.CONFLICT);
    }

    const customDomain = input.customDomain?.trim().toLowerCase() || undefined;
    if (customDomain) {
      const domainTaken = await this.studio.findFirst({ where: { customDomain } });
      if (domainTaken) {
        throw new ApiError("That custom domain is already in use", HttpCode.CONFLICT);
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
        ...(input.platformFeePercent !== undefined
          ? { platformFeePercent: input.platformFeePercent }
          : {}),
        ...(sub?.customerCode ? { paystackCustomerCode: sub.customerCode } : {}),
        ...(sub?.subscriptionCode ? { subscriptionCode: sub.subscriptionCode } : {}),
        ...(sub?.status ? { subscriptionStatus: sub.status } : {}),
        ...(sub?.currentPeriodEnd ? { currentPeriodEnd: sub.currentPeriodEnd } : {}),
        ...(customDomain ? { customDomain } : {}),
      },
    });

    const owner = await this.user.create({
      data: {
        email: input.ownerEmail,
        password: input.ownerPasswordHash,
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
    const flags = { ...planFlags(input.plan), ...(input.settingsOverride ?? {}) };
    await this.studioSettings.create({
      data: { studioId: studio.id, ...flags },
    });
    await this.studioBranding.create({ data: { studioId: studio.id } });
    await this.studioContent.create({
      data: { studioId: studio.id, heroHeadline: input.name, showTestimonials: true },
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
        throw new ApiError("Fee must be between 0 and 100", HttpCode.BAD_REQUEST);
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
        throw new ApiError("Studio name must be 2-60 characters", HttpCode.BAD_REQUEST);
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
          throw new ApiError("That custom domain is already in use", HttpCode.CONFLICT);
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
    return this.getStudio(id);
  }

  public async updateSettings(id: string, settings: StudioSettingsInput) {
    const studio = await this.studio.findUnique({ where: { id } });
    if (!studio) throw new ApiError("Studio not found", HttpCode.NOT_FOUND);

    const patch = Object.fromEntries(
      Object.entries(settings).filter(
        ([k, v]) =>
          typeof v === "boolean" &&
          [
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
  public async impersonate(id: string) {
    const studio = await this.studio.findUnique({ where: { id } });
    if (!studio) throw new ApiError("Studio not found", HttpCode.NOT_FOUND);
    if (!studio.ownerUserId) {
      throw new ApiError("This studio has no owner to impersonate", HttpCode.BAD_REQUEST);
    }

    const owner = await this.user.findUnique({
      where: { id: studio.ownerUserId },
      select: { id: true, email: true, role: true, studioId: true },
    });
    if (!owner) {
      throw new ApiError("Studio owner not found", HttpCode.NOT_FOUND);
    }

    const token = loginToken({
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
