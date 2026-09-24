import { createTenantClient, RawDb, TenantDb } from "../tenant/tenantClient";
import { getTenantContext } from "../tenant/context";
import { shortId, studioCode } from "../utils/shortId";
import { env } from "../config/env.config";
import { StudioBrandingInfo } from "../notifications/types";
import { S3BucketService } from "../bucket/s3BucketService";

/**
 * Base class every service extends. It exposes the Prisma model delegates as
 * getters that point at the tenant-scoped client, so existing `this.<model>`
 * call sites keep working unchanged while every query is now scoped to the
 * current studio (see src/tenant). Lifecycle ($connect/$disconnect) uses the
 * raw client.
 */
export class Connection {
  protected readonly raw: RawDb;
  protected readonly db: TenantDb;

  constructor() {
    const clients = createTenantClient();
    this.raw = clients.raw;
    this.db = clients.db;
  }

  async connect() {
    try {
      await this.raw.$connect();
      console.log("Database connected successfully.");
    } catch (error) {
      console.error("Error connecting to the database:", error);
      process.exit(1);
    }
  }

  async disconnect() {
    await this.raw.$disconnect();
    console.log("Database disconnected successfully.");
  }

  // ---- Tenant-owned model delegates (scoped by the tenant extension) ----
  get user() { return this.db.user; }
  get profile() { return this.db.profile; }
  get appointment() { return this.db.appointment; }
  get service() { return this.db.service; }
  get serviceAddOn() { return this.db.serviceAddOn; }
  get payment() { return this.db.payment; }
  get paymentSettings() { return this.db.paymentSettings; }
  get review() { return this.db.review; }
  get gallery() { return this.db.gallery; }
  get category() { return this.db.category; }
  get businessHours() { return this.db.businessHours; }
  get blockedDate() { return this.db.blockedDate; }
  get contactInfo() { return this.db.contactInfo; }
  get loyaltyPoints() { return this.db.loyaltyPoints; }
  get loyaltyTransaction() { return this.db.loyaltyTransaction; }
  get referralCode() { return this.db.referralCode; }
  get referral() { return this.db.referral; }
  get product() { return this.db.product; }
  get productCategory() { return this.db.productCategory; }
  get cart() { return this.db.cart; }
  get cartItem() { return this.db.cartItem; }
  get order() { return this.db.order; }
  get orderItem() { return this.db.orderItem; }
  get referralOrderReward() { return this.db.referralOrderReward; }
  get commerceSettings() { return this.db.commerceSettings; }
  get promoBanner() { return this.db.promoBanner; }

  // The current studio's Paystack subaccount code (for split settlement), or
  // null when the studio hasn't connected a payout account — in which case
  // payments settle to the platform account as before.
  protected async currentStudioSubaccount(): Promise<string | null> {
    const studioId = getTenantContext()?.studioId;
    if (!studioId) return null;
    const studio = await this.studio.findUnique({
      where: { id: studioId },
      select: { paystackSubaccountCode: true },
    });
    return studio?.paystackSubaccountCode ?? null;
  }

  // Paystack reference: `<PREFIX>-<STUDIO-SLUG>-<uuid>` so a reference in a
  // log/error/dashboard immediately tells you which studio it belongs to.
  protected async makeReference(prefix: string): Promise<string> {
    const studioId = getTenantContext()?.studioId;
    let slug = "ZURI";
    if (studioId) {
      const studio = await this.studio.findUnique({
        where: { id: studioId },
        select: { name: true, slug: true },
      });
      if (studio) slug = studioCode(studio.name, studio.slug);
    }
    return `${prefix}-${slug}-${shortId()}`;
  }

  // The current studio's display name, for customer-facing emails/receipts.
  // Falls back to the platform name when there's no studio in context.
  protected async currentStudioName(): Promise<string> {
    const studioId = getTenantContext()?.studioId;
    if (!studioId) return "Zuri Studios";
    const studio = await this.studio.findUnique({
      where: { id: studioId },
      select: { name: true },
    });
    return studio?.name ?? "Zuri Studios";
  }

  // Full studio branding (name, logo, colour, storefront/booking URLs, contact
  // details) — used to render studio-branded notification emails so one
  // template works for every studio. Returns null when there's no studio to
  // resolve.
  //
  // Pass `studioIdOverride` when calling from OUTSIDE that studio's own
  // request context — e.g. a cron sweep running in the super-admin context
  // (reconcilePendingPayments, billing reminders), which has to build the
  // *payment/studio row's own* branding, not whatever's ambient. This matters
  // because of how the tenant extension behaves (see tenantExtension.ts):
  // in a normal per-request (non-super-admin) context it silently overwrites
  // any `where.studioId` you pass with the ambient one, but in the
  // super-admin context scoping is bypassed entirely and an explicit
  // `where.studioId` is honoured as-is — so `contactInfo.findFirst` MUST be
  // given it explicitly here, or a cron job would read an arbitrary studio's
  // contact info instead of the one it's actually notifying.
  protected async currentStudioBranding(
    studioIdOverride?: string,
  ): Promise<(StudioBrandingInfo & { slug: string }) | null> {
    const studioId = studioIdOverride ?? getTenantContext()?.studioId;
    if (!studioId) return null;
    const [studio, branding, contact] = await Promise.all([
      this.studio.findUnique({ where: { id: studioId }, select: { name: true, slug: true } }),
      this.studioBranding.findUnique({ where: { studioId }, select: { logoUrl: true, primaryColor: true } }),
      this.contactInfo.findFirst({ where: { studioId }, select: { email: true, phone: true, address: true } }),
    ]);
    if (!studio) return null;
    const websiteUrl = env.rootDomain
      ? `https://${studio.slug}.${env.rootDomain}`
      : `${env.clientUrl}/s/${studio.slug}`;
    return {
      name: studio.name,
      slug: studio.slug,
      logoUrl: new S3BucketService().deliveryUrl(branding?.logoUrl ?? null) ?? null,
      primaryColor: branding?.primaryColor ?? null,
      websiteUrl,
      bookingUrl: `${websiteUrl}/book`,
      email: contact?.email ?? null,
      phone: contact?.phone ?? null,
      address: contact?.address ?? null,
    };
  }

  // Where to send a studio-owner notification (new booking request, etc): the
  // studio's published contact email if set and shown, else the account
  // owner's login email. Null when neither is available.
  protected async currentStudioNotifyEmail(studioIdOverride?: string): Promise<string | null> {
    const studioId = studioIdOverride ?? getTenantContext()?.studioId;
    if (!studioId) return null;
    const contact = await this.contactInfo.findFirst({
      where: { studioId },
      select: { email: true, showEmail: true },
    });
    if (contact?.showEmail && contact.email) return contact.email;

    const studio = await this.studio.findUnique({
      where: { id: studioId },
      select: { ownerUserId: true },
    });
    if (!studio?.ownerUserId) return null;
    const owner = await this.user.findUnique({
      where: { id: studio.ownerUserId },
      select: { email: true },
    });
    return owner?.email ?? null;
  }

  // Max share of a booking/order payable with loyalty points, as a ratio, from
  // the current studio's settings (studio-admin controlled). Defaults to 0.3.
  protected async loyaltyCapRatio(): Promise<number> {
    const studioId = getTenantContext()?.studioId;
    if (!studioId) return 0.3;
    const s = await this.studioSettings.findFirst({
      where: { studioId },
      select: { loyaltyCapPercent: true },
    });
    return (s?.loyaltyCapPercent ?? 30) / 100;
  }

  // ---- Platform models (not auto-scoped; used by super-admin/onboarding) ----
  get studio() { return this.db.studio; }
  get studioBranding() { return this.db.studioBranding; }
  get studioContent() { return this.db.studioContent; }
  get studioSettings() { return this.db.studioSettings; }
  get featureRequest() { return this.db.featureRequest; }
  get auditLog() { return this.db.auditLog; }
  get platformActivityLog() { return this.db.platformActivityLog; }
  get notificationLog() { return this.db.notificationLog; }
  get studioSignup() { return this.db.studioSignup; }
  get platformReview() { return this.db.platformReview; }
  get platformConfig() { return this.db.platformConfig; }
}
