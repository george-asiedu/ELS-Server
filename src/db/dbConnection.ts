import { createTenantClient, RawDb, TenantDb } from "../tenant/tenantClient";
import { getTenantContext } from "../tenant/context";

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
  get studioSignup() { return this.db.studioSignup; }
  get platformReview() { return this.db.platformReview; }
}
