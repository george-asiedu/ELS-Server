import { Connection } from "../db/dbConnection";
import { S3BucketService } from "../bucket/s3BucketService";
import { ApiError } from "../middleware/apiError";
import { HttpCode } from "../models/status_codes";
import { UploadedFile } from "../models/user";
import { paystack } from "../payment/paystackClient";
import { env } from "../config/env.config";
import { randomUUID } from "crypto";
import { promises as dns } from "dns";
import { planFlags } from "../platform/platformService";
import {
  Plan,
  Cadence,
  pricePesewas,
  extendPeriod,
  isLapsed,
} from "../billing/billingPlans";
import {
  resolveStudioByDomain,
  forgetStudioDomain,
} from "../tenant/studioResolver";

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
    throw new ApiError(`${field} must be a hex color like #4F46E5`, HttpCode.BAD_REQUEST);
  }
  return s;
};

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
      throw new ApiError("Each feature card needs a title", HttpCode.BAD_REQUEST);
    }
    return {
      icon: String(c.icon ?? "sparkles").trim().toLowerCase().slice(0, 24),
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
export class StudioService extends Connection {
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
        logoUrl: studio.branding?.logoUrl ?? null,
        primaryColor: studio.branding?.primaryColor ?? null,
        accentColor: studio.branding?.accentColor ?? null,
        fontFamily: studio.branding?.fontFamily ?? null,
      },
      content: {
        heroHeadline: studio.content?.heroHeadline ?? null,
        heroSubtext: studio.content?.heroSubtext ?? null,
        aboutText: studio.content?.aboutText ?? null,
        featureCards: studio.content?.featureCards ?? null,
        showTestimonials: studio.content?.showTestimonials ?? true,
      },
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
    return { message: "Branding retrieved", data: branding };
  }

  public async updateBranding(
    studioId: string | null | undefined,
    input: {
      primaryColor?: unknown;
      accentColor?: unknown;
      fontFamily?: unknown;
      removeLogo?: unknown;
    },
    logoFile?: UploadedFile,
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
      const font = String(input.fontFamily ?? "").trim().slice(0, 60);
      data.fontFamily = font || null;
    }

    if (logoFile) {
      data.logoUrl = await this.s3.uploadFile(logoFile, { maxDim: 512, quality: 90 });
    } else if (
      input.removeLogo === true ||
      input.removeLogo === "true"
    ) {
      data.logoUrl = null;
    }

    const branding = await this.studioBranding.upsert({
      where: { studioId: id },
      update: data,
      create: { studioId: id, ...data },
    });
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
        ? { name: `_zuri-verify.${studio.customDomain}`, value: `zuri-verify=${token}` }
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
      throw new ApiError("Enter a valid domain (e.g. book.mystudio.com)", HttpCode.BAD_REQUEST);
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
    return { message: "Domain saved — add the DNS record, then verify", data: this.domainPayload(updated) };
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
      const records = await dns.resolveTxt(`_zuri-verify.${studio.customDomain}`);
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
    if (!studio) throw new ApiError("No studio for this domain", HttpCode.NOT_FOUND);
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

  // Start a plan/cadence change: charge the new plan's price once. On success
  // the frontend calls applyBillingChange().
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
    if (studio.billingMode === "REVENUE_SHARE") {
      throw new ApiError(
        "Your account bills per transaction; plan changes are handled by the Zuri team.",
        HttpCode.BAD_REQUEST,
      );
    }
    if (studio.plan === plan && studio.billingCadence === cadence) {
      throw new ApiError("You're already on this plan", HttpCode.BAD_REQUEST);
    }
    const email = await this.ownerEmail(id);
    const amountPesewas = pricePesewas(plan as Plan, cadence as Cadence);
    if (!amountPesewas) {
      throw new ApiError("Billing is not configured for that plan", HttpCode.BAD_GATEWAY);
    }
    const reference = `ZURI-BILLING-${randomUUID()}`;
    const init = await paystack.initialize({
      email,
      amountPesewas,
      reference,
      callbackUrl: `${env.clientUrl}/admin/billing`,
      metadata: { kind: "billing", studioId: id, plan, cadence },
    });
    return {
      message: "Plan change started",
      data: {
        reference,
        accessCode: init.access_code,
        publicKey: env.paystack.publicKey,
      },
    };
  }

  // Apply the change after payment succeeds: switch plan + feature flags and
  // start a fresh billing period.
  public async applyBillingChange(
    studioId: string | null | undefined,
    reference: string,
    plan: string,
    cadence: string,
  ) {
    const id = this.requireStudioId(studioId);
    if (!reference.startsWith("ZURI-BILLING-")) {
      throw new ApiError("Invalid reference", HttpCode.BAD_REQUEST);
    }
    if (!["STANDARD", "PREMIUM"].includes(plan)) {
      throw new ApiError("Invalid plan", HttpCode.BAD_REQUEST);
    }
    const targetCadence: Cadence = cadence === "YEARLY" ? "YEARLY" : "MONTHLY";
    await this.assertPaid(reference);

    const studio = await this.studio.findUnique({ where: { id } });
    if (!studio) throw new ApiError("Studio not found", HttpCode.NOT_FOUND);

    // A plan change starts a fresh period from now.
    await this.studio.update({
      where: { id },
      data: {
        plan: plan as Plan,
        billingCadence: targetCadence,
        subscriptionStatus: "active",
        currentPeriodEnd: extendPeriod(null, targetCadence),
      },
    });
    const flags = planFlags(plan as Plan);
    await this.studioSettings.upsert({
      where: { studioId: id },
      update: flags,
      create: { studioId: id, ...flags },
    });
    return this.getBilling(id);
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
    const email = await this.ownerEmail(id);
    const amountPesewas = pricePesewas(
      studio.plan as Plan,
      studio.billingCadence as Cadence,
    );
    if (!amountPesewas) {
      throw new ApiError("Billing is not configured for that plan", HttpCode.BAD_GATEWAY);
    }
    const reference = `ZURI-RENEW-${randomUUID()}`;
    const init = await paystack.initialize({
      email,
      amountPesewas,
      reference,
      callbackUrl: `${env.clientUrl}/admin/billing`,
      metadata: {
        kind: "renewal",
        studioId: id,
        plan: studio.plan,
        cadence: studio.billingCadence,
      },
    });
    return {
      message: "Renewal started",
      data: {
        reference,
        accessCode: init.access_code,
        publicKey: env.paystack.publicKey,
      },
    };
  }

  // Apply a renewal after payment succeeds: extend the period (keeping any
  // unused days) and re-activate the studio if it had been suspended.
  public async applyRenewal(
    studioId: string | null | undefined,
    reference: string,
  ) {
    const id = this.requireStudioId(studioId);
    if (!reference.startsWith("ZURI-RENEW-")) {
      throw new ApiError("Invalid reference", HttpCode.BAD_REQUEST);
    }
    await this.assertPaid(reference);
    const studio = await this.studio.findUnique({
      where: { id },
      select: { billingCadence: true, currentPeriodEnd: true, status: true },
    });
    if (!studio) throw new ApiError("Studio not found", HttpCode.NOT_FOUND);
    await this.studio.update({
      where: { id },
      data: {
        subscriptionStatus: "active",
        currentPeriodEnd: extendPeriod(
          studio.currentPeriodEnd,
          studio.billingCadence as Cadence,
        ),
        ...(studio.status === "SUSPENDED" ? { status: "ACTIVE" } : {}),
      },
    });
    return this.getBilling(id);
  }

  private async assertPaid(reference: string) {
    let paid = false;
    try {
      const data = await paystack.verify(reference);
      paid = data.status === "success";
    } catch {
      paid = false;
    }
    if (!paid) throw new ApiError("Payment not confirmed", HttpCode.BAD_REQUEST);
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

  public async getContent(studioId: string | null | undefined) {
    const id = this.requireStudioId(studioId);
    const content = await this.studioContent.upsert({
      where: { studioId: id },
      update: {},
      create: { studioId: id },
    });
    return { message: "Content retrieved", data: content };
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
      return { message: "Account resolved", data: { accountName: res.account_name } };
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
    const type = String(input.type ?? "momo").trim() === "bank" ? "bank" : "momo";
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
    input: {
      heroHeadline?: unknown;
      heroSubtext?: unknown;
      aboutText?: unknown;
      featureCards?: unknown;
      showTestimonials?: unknown;
    },
  ) {
    const id = this.requireStudioId(studioId);

    const data: {
      heroHeadline?: string | null;
      heroSubtext?: string | null;
      aboutText?: string | null;
      featureCards?: FeatureCard[];
      showTestimonials?: boolean;
    } = {};

    const text = (v: unknown, max: number) => {
      const s = String(v ?? "").trim();
      return s ? s.slice(0, max) : null;
    };

    if (input.heroHeadline !== undefined)
      data.heroHeadline = text(input.heroHeadline, 100);
    if (input.heroSubtext !== undefined)
      data.heroSubtext = text(input.heroSubtext, 300);
    if (input.aboutText !== undefined)
      data.aboutText = text(input.aboutText, 500);

    const cards = sanitizeFeatureCards(input.featureCards);
    if (cards !== undefined) data.featureCards = cards;

    if (input.showTestimonials !== undefined)
      data.showTestimonials = Boolean(input.showTestimonials);

    const content = await this.studioContent.upsert({
      where: { studioId: id },
      update: data,
      create: { studioId: id, ...data },
    });
    return { message: "Content updated", data: content };
  }
}
