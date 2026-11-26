import { PAID_ORDER_STATUSES } from "../order/orderStatus";
import { STUDIO_TYPES, isStudioType, parseStudioTypes } from "./studioTypes";
import { Connection } from "../db/dbConnection";
import { S3BucketService } from "../bucket/s3BucketService";
import { ApiError } from "../middleware/apiError";
import { HttpCode } from "../models/status_codes";
import { paystack } from "../payment/paystackClient";
import { env } from "../config/env.config";
import { whatsappConfigured } from "../whatsapp/whatsappService";
import { randomUUID } from "crypto";
import { promises as dns } from "dns";
import { StudioBillingService } from "../billing/studioBillingService";
import { isShopCategory, parseShopCategories } from "../billing/shopCategories";
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

// Kinds of studio live in studio/studioTypes.ts; website layouts here.
// Mirrored by the frontend's lib/studioTemplates.ts.
export { STUDIO_TYPES };
export const SITE_TEMPLATES = ["editorial", "bold", "minimal"] as const;

export class StudioService extends Connection {
  private billing = new StudioBillingService();

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
      // What the shop sells: picks the shop website's design.
      shopCategory: studio.shopCategory ?? null,
      // Everything the shop sells; the first is shopCategory.
      shopCategories: studio.shopCategories,
      plan: studio.plan,
      branding: {
        logoUrl: this.s3.deliveryUrl(studio.branding?.logoUrl ?? null) ?? null,
        primaryColor: studio.branding?.primaryColor ?? null,
        accentColor: studio.branding?.accentColor ?? null,
        fontFamily: studio.branding?.fontFamily ?? null,
      },
      content: this.publicContent(studio.content),
      settings: {
        booking: studio.settings?.booking ?? true,
        commerce: studio.settings?.commerce ?? false,
        loyalty: studio.settings?.loyalty ?? true,
        referrals: studio.settings?.referrals ?? true,
        reviews: studio.settings?.reviews ?? true,
        gallery: studio.settings?.gallery ?? true,
        onlinePayments: studio.settings?.onlinePayments ?? false,
        productsInBooking: studio.settings?.productsInBooking ?? false,
        loyaltyCapPercent: studio.settings?.loyaltyCapPercent ?? 30,
        // So checkout can show the fee before the customer pays.
        customerPaysFee:
          (studio.settings?.paystackFeePayer ?? "CUSTOMER") === "CUSTOMER",
        processingFeePercent: env.paystack.feePercent,
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
      studioType:
        (content as { studioType?: string | null } | null | undefined)
          ?.studioType ?? null,
      // Every kind the studio offers; the first is studioType.
      studioTypes:
        (content as { studioTypes?: string[] } | null | undefined)
          ?.studioTypes ?? [],
      siteTemplate:
        (content as { siteTemplate?: string | null } | null | undefined)
          ?.siteTemplate ?? null,
    };
  }

  public async getContent(studioId: string | null | undefined) {
    const id = this.requireStudioId(studioId);
    const content = await this.studioContent.upsert({
      where: { studioId: id },
      update: {},
      create: { studioId: id },
    });
    return {
      message: "Content retrieved",
      data: await this.withShopCategory(id, content),
    };
  }

  // ---- Public: the studio's numbers, for its website ---------------------

  /**
   * Real figures for the website's metrics strip. A figure is only returned
   * once it means something (a new studio doesn't advertise "0 clients"),
   * so the strip shows what's true and hides what isn't there yet.
   */
  public async getPublicStats(studioId: string | null | undefined) {
    const id = this.requireStudioId(studioId);
    const [completed, clients, rating, services, studio] = await Promise.all([
      this.appointment.count({ where: { status: "COMPLETED" } }),
      this.appointment.groupBy({
        by: ["phone"],
        where: { status: { in: ["COMPLETED", "CONFIRMED"] } },
      }),
      this.review.aggregate({
        where: { approved: true },
        _avg: { rating: true },
        _count: { _all: true },
      }),
      this.service.count({ where: { active: true } }),
      this.studio.findUnique({ where: { id }, select: { createdAt: true } }),
    ]);
    const reviews = rating._count._all;
    return {
      message: "Studio stats",
      data: {
        appointmentsCompleted: completed >= 10 ? completed : null,
        clientsServed: clients.length >= 10 ? clients.length : null,
        averageRating:
          reviews >= 3 && rating._avg.rating
            ? Math.round(rating._avg.rating * 10) / 10
            : null,
        reviewCount: reviews >= 3 ? reviews : null,
        servicesOffered: services || null,
        onZuriSince: studio?.createdAt ?? null,
      },
    };
  }

  // ---- Admin: the studio's money ----------------------------------------

  /**
   * Where the studio's money stands, for its dashboard: what customers paid
   * (after refunds), and what Paystack has paid out to the studio's own bank
   * or Mobile Money account and still has on the way. Customer payments go
   * into the studio's Paystack subaccount, never to the platform, so the
   * payout figures come straight from Paystack.
   */
  public async getMoney(studioId: string | null | undefined) {
    const id = this.requireStudioId(studioId);
    const studio = await this.studio.findUnique({
      where: { id },
      select: {
        paystackSubaccountCode: true,
        platformFeePercent: true,
        billingMode: true,
        payoutType: true,
        payoutProvider: true,
        payoutAccountNumber: true,
        payoutAccountName: true,
      },
    });
    if (!studio) throw new ApiError("Studio not found", HttpCode.NOT_FOUND);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    // The same stretch of last month, for a fair "vs last month".
    const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevEnd = new Date(now);
    prevEnd.setMonth(now.getMonth() - 1);
    // Summed in the database rather than by loading every payment and order:
    // the same figures, without the cost growing with the business's history.
    // Booking payments count by paidAt; orders by paidAt, else createdAt.
    const paidPaymentStatuses = [
      "PAID",
      "PARTIALLY_REFUNDED",
      "REFUNDED",
    ] as const;
    const paidOrder = { status: { in: [...PAID_ORDER_STATUSES] } };
    const orderDated = (range: { gte: Date; lte?: Date }) => ({
      OR: [{ paidAt: range }, { paidAt: null, createdAt: range }],
    });
    const sumPayments = (extra: object = {}) =>
      this.payment.aggregate({
        where: {
          status: { in: [...paidPaymentStatuses] },
          ...extra,
        },
        _sum: { amount: true, refundedAmount: true },
      });
    const sumOrders = (extra: object = {}) =>
      this.order.aggregate({
        where: { ...paidOrder, ...extra },
        _sum: { total: true, refundedAmount: true },
      });
    const [pAll, pMonth, pPrev, oAll, oMonth, oPrev] = await Promise.all([
      sumPayments(),
      sumPayments({ paidAt: { gte: monthStart } }),
      sumPayments({ paidAt: { gte: prevStart, lte: prevEnd } }),
      sumOrders(),
      sumOrders(orderDated({ gte: monthStart })),
      sumOrders(orderDated({ gte: prevStart, lte: prevEnd })),
    ]);
    const netP = (a: typeof pAll) =>
      (a._sum.amount ?? 0) - (a._sum.refundedAmount ?? 0);
    const netO = (a: typeof oAll) =>
      (a._sum.total ?? 0) - (a._sum.refundedAmount ?? 0);
    const allTime = netP(pAll) + netO(oAll);
    const thisMonth = netP(pMonth) + netO(oMonth);
    const lastMonthSoFar = netP(pPrev) + netO(oPrev);
    const refunded =
      (pAll._sum.refundedAmount ?? 0) + (oAll._sum.refundedAmount ?? 0);
    const r2 = (n: number) => Math.round(n * 100) / 100;

    // Payouts, from Paystack. Optional: the rest of the card still works if
    // Paystack can't be reached or there's no payout account yet.
    let payouts: {
      paidOut: number;
      onTheWay: number;
      last: { amount: number; date: string | null } | null;
      next: { amount: number; date: string | null } | null;
      recent: {
        id: number;
        amount: number;
        fees: number;
        status: string;
        date: string | null;
      }[];
    } | null = null;
    let payoutsError: string | null = null;
    if (studio.paystackSubaccountCode) {
      try {
        const list = await paystack.listSettlements(
          studio.paystackSubaccountCode,
        );
        const amt = (x: { effective_amount?: number; total_amount: number }) =>
          r2((x.effective_amount ?? x.total_amount) / 100);
        const done = list.filter((x) => x.status === "success");
        const waiting = list.filter(
          (x) => x.status === "pending" || x.status === "processing",
        );
        const byDate = (a: {
          settlement_date: string | null;
          createdAt: string;
        }) => new Date(a.settlement_date ?? a.createdAt).getTime();
        const last = [...done].sort((a, b) => byDate(b) - byDate(a))[0];
        const next = [...waiting].sort((a, b) => byDate(a) - byDate(b))[0];
        payouts = {
          paidOut: r2(done.reduce((t, x) => t + amt(x), 0)),
          onTheWay: r2(waiting.reduce((t, x) => t + amt(x), 0)),
          last: last ? { amount: amt(last), date: last.settlement_date } : null,
          next: next ? { amount: amt(next), date: next.settlement_date } : null,
          recent: list.slice(0, 5).map((x) => ({
            id: x.id,
            amount: amt(x),
            fees: r2((x.total_fees ?? 0) / 100),
            status: x.status,
            date: x.settlement_date ?? x.createdAt,
          })),
        };
      } catch (error) {
        payoutsError =
          error instanceof Error ? error.message : "Couldn't reach Paystack";
      }
    }

    const masked = studio.payoutAccountNumber
      ? `•••• ${studio.payoutAccountNumber.slice(-4)}`
      : null;
    return {
      message: "Money",
      data: {
        received: {
          thisMonth: r2(thisMonth),
          lastMonthSoFar: r2(lastMonthSoFar),
          allTime: r2(allTime),
          refunded: r2(refunded),
        },
        payoutAccount: studio.paystackSubaccountCode
          ? {
              type: studio.payoutType,
              provider: studio.payoutProvider,
              name: studio.payoutAccountName,
              number: masked,
            }
          : null,
        payouts,
        payoutsError,
        // Pay-as-you-earn studios: the platform's share of each payment.
        commissionPercent:
          studio.billingMode === "REVENUE_SHARE"
            ? studio.platformFeePercent
            : null,
      },
    };
  }

  // ---- Admin: WhatsApp messages to customers ------------------------------

  public async getMessaging(studioId: string | null | undefined) {
    const id = this.requireStudioId(studioId);
    const settings = await this.studioSettings.findUnique({
      where: { studioId: id },
      select: { whatsappMessages: true },
    });
    return {
      message: "Messaging settings",
      data: {
        // Whether the platform has WhatsApp set up at all.
        whatsappAvailable: whatsappConfigured,
        whatsappMessages: settings?.whatsappMessages ?? false,
      },
    };
  }

  public async setMessaging(
    studioId: string | null | undefined,
    whatsappMessages: unknown,
  ) {
    const id = this.requireStudioId(studioId);
    if (typeof whatsappMessages !== "boolean")
      throw new ApiError(
        "Say whether to send WhatsApp messages",
        HttpCode.BAD_REQUEST,
      );
    if (whatsappMessages && !whatsappConfigured)
      throw new ApiError(
        "WhatsApp messages aren't available yet",
        HttpCode.BAD_REQUEST,
      );
    await this.studioSettings.upsert({
      where: { studioId: id },
      update: { whatsappMessages },
      create: { studioId: id, whatsappMessages },
    });
    return this.getMessaging(id);
  }

  // ---- Admin: who pays Paystack's fee -------------------------------------

  public async getFeePayer(studioId: string | null | undefined) {
    const id = this.requireStudioId(studioId);
    const settings = await this.studioSettings.findUnique({
      where: { studioId: id },
      select: { paystackFeePayer: true },
    });
    return {
      message: "Fee settings",
      data: {
        payer: settings?.paystackFeePayer ?? "CUSTOMER",
        feePercent: env.paystack.feePercent,
      },
    };
  }

  public async setFeePayer(
    studioId: string | null | undefined,
    payer: unknown,
  ) {
    const id = this.requireStudioId(studioId);
    if (payer !== "CUSTOMER" && payer !== "BUSINESS") {
      throw new ApiError(
        "Choose who pays the fee: CUSTOMER or BUSINESS",
        HttpCode.BAD_REQUEST,
      );
    }
    await this.studioSettings.upsert({
      where: { studioId: id },
      update: { paystackFeePayer: payer },
      create: { studioId: id, paystackFeePayer: payer },
    });
    return this.getFeePayer(id);
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
      studioType?: unknown;
      studioTypes?: unknown;
      siteTemplate?: unknown;
      shopCategory?: unknown;
      shopCategories?: unknown;
    },
  ) {
    const id = this.requireStudioId(studioId);

    const data: Partial<
      Record<ContentTextField | ContentImageField, string | null>
    > & {
      featureCards?: FeatureCard[];
      showTestimonials?: boolean;
      studioType?: string | null;
      studioTypes?: string[];
      siteTemplate?: string | null;
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

    // Fixed choices; blank = back to the default.
    const choice = (v: unknown, allowed: readonly string[], label: string) => {
      if (v === null || v === "") return null;
      if (typeof v !== "string" || !allowed.includes(v)) {
        throw new ApiError(`Unknown ${label}`, HttpCode.BAD_REQUEST);
      }
      return v;
    };
    if (input.studioTypes !== undefined) {
      // Several kinds; the first is the main one and picks the wording.
      const list = Array.isArray(input.studioTypes) ? input.studioTypes : [];
      if (list.some((t) => !isStudioType(t))) {
        throw new ApiError("Unknown studio type", HttpCode.BAD_REQUEST);
      }
      const types = parseStudioTypes(list);
      data.studioTypes = types;
      data.studioType = types[0] ?? null;
    } else if (input.studioType !== undefined) {
      data.studioType = choice(input.studioType, STUDIO_TYPES, "studio type");
    }
    // What the shop sells lives on the studio itself (set at signup).
    if (input.shopCategories !== undefined) {
      // Several kinds; the first is the main one and picks the design.
      const list = Array.isArray(input.shopCategories)
        ? input.shopCategories
        : [];
      if (list.some((c) => !isShopCategory(c))) {
        throw new ApiError("Unknown shop category", HttpCode.BAD_REQUEST);
      }
      const cats = parseShopCategories(list);
      await this.studio.update({
        where: { id },
        data: { shopCategories: cats, shopCategory: cats[0] ?? null },
      });
    } else if (input.shopCategory !== undefined) {
      const cat = input.shopCategory;
      if (cat !== null && cat !== "" && !isShopCategory(cat)) {
        throw new ApiError("Unknown shop category", HttpCode.BAD_REQUEST);
      }
      // A new main kind goes first; the others the shop sells are kept.
      const current = await this.studio.findUnique({
        where: { id },
        select: { shopCategories: true },
      });
      const main = (cat as string | null) || null;
      await this.studio.update({
        where: { id },
        data: {
          shopCategory: main,
          shopCategories: main
            ? parseShopCategories([main, ...(current?.shopCategories ?? [])])
            : [],
        },
      });
    }
    if (input.siteTemplate !== undefined)
      data.siteTemplate = choice(
        input.siteTemplate,
        SITE_TEMPLATES,
        "website design",
      );

    const content = await this.studioContent.upsert({
      where: { studioId: id },
      update: data,
      create: { studioId: id, ...data },
    });
    return {
      message: "Content updated",
      data: await this.withShopCategory(id, content),
    };
  }

  // The admin editor shows what the shop sells next to the content.
  private async withShopCategory(
    id: string,
    content: Parameters<StudioService["publicContent"]>[0],
  ) {
    const studio = await this.studio.findUnique({
      where: { id },
      select: { shopCategory: true, shopCategories: true },
    });
    return {
      ...this.publicContent(content),
      shopCategory: studio?.shopCategory ?? null,
      shopCategories: studio?.shopCategories ?? [],
    };
  }

  // ---- Billing (lives in billing/studioBillingService) -----------------

  public getBilling(studioId: string | null | undefined) {
    return this.billing.getBilling(studioId);
  }

  public startBillingChange(
    studioId: string | null | undefined,
    plan: string,
    cadence: string,
    promoCode?: unknown,
  ) {
    return this.billing.startBillingChange(studioId, plan, cadence, promoCode);
  }

  public startRenewal(
    studioId: string | null | undefined,
    promoCode?: unknown,
  ) {
    return this.billing.startRenewal(studioId, promoCode);
  }

  public startExtrasPayment(studioId: string | null | undefined) {
    return this.billing.startExtrasPayment(studioId);
  }

  public applyExtrasPayment(
    studioId: string | null | undefined,
    reference: string,
  ) {
    return this.billing.applyExtrasPayment(studioId, reference);
  }

  public applyBillingChange(
    studioId: string | null | undefined,
    reference: string,
  ) {
    return this.billing.applyBillingChange(studioId, reference);
  }

  public applyRenewal(studioId: string | null | undefined, reference: string) {
    return this.billing.applyRenewal(studioId, reference);
  }

  public applyBillingCharge(reference: string) {
    return this.billing.applyBillingCharge(reference);
  }

  public checkBillingReminders() {
    return this.billing.checkBillingReminders();
  }
}
