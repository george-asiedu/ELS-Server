import { rewardBusinessReferral } from "../billing/businessReferral";
import jwt from "jsonwebtoken";
import { shortId } from "../utils/shortId";
import { studioLink } from "../utils/studioLink";
import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import { HttpCode } from "../models/status_codes";
import { env } from "../config/env.config";
import { getPasswordHash } from "../utils/helper";
import { runAsSuperAdmin } from "../tenant/context";
import { paystack } from "../payment/paystackClient";
import { AuditService } from "../audit/auditService";
import {
  PlatformService,
  validateStudioSlug,
  commissionFor,
  setupFeeFor,
  subscriptionSetupFor,
  planPriceFor,
} from "../platform/platformService";
import {
  Plan,
  Cadence,
  toPesewas,
  addPeriod,
  addMonths,
  isPlan,
  planName,
} from "../billing/billingPlans";
import { isShopCategory, type ShopCategory } from "../billing/shopCategories";
import { NotificationService } from "../notifications/notificationService";
import { buildReceiptPdf } from "../notifications/receiptPdf";
import { ghs, receiptNumber } from "../notifications/format";
import { NotificationTemplate } from "../notifications/registry";
import { studioCreated } from "../notifications/templates/studio";
import { confirmEmailCode, sendEmailCode } from "../auth/emailCode";
import { countPromoUse, promoPercent } from "../billing/studioPricing";
import { platformBrandForPlan } from "../notifications/brand";
import { platformBrand } from "../notifications/brand";

type BillingMode = "SUBSCRIPTION" | "REVENUE_SHARE";

const EMAIL_PROOF_PURPOSE = "signup-email";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Min 8 chars with an uppercase, lowercase, number, and special character —
// matches the login/signup validators so a new owner can sign in right after.
const PASSWORD_RE =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};'"\\|,.<>/?]).{8,}$/;

// Signup references are prefixed so the shared Paystack webhook can tell a
// studio-billing payment apart from a booking/order payment.
const SIGNUP_PREFIX = "ZURI-SIGNUP-";
export const isSignupReference = (ref: string) => ref.startsWith(SIGNUP_PREFIX);

/**
 * Public, payment-gated studio signup. A signup is held as a StudioSignup until
 * Paystack confirms payment, then provisioned into a real Studio. Provisioning
 * always runs in the super-admin context so the new studio's scoped rows get the
 * right studioId regardless of which studio the request resolved to.
 */
export class OnboardingService extends Connection {
  private platform = new PlatformService();
  private audit = new AuditService();
  private notifications = new NotificationService();

  /** Check a billing promo for the signup screen. */
  public async checkPromo(rawCode: unknown, rawPlan: unknown) {
    const plan: Plan = isPlan(rawPlan) ? rawPlan : "STANDARD";
    const promo = await promoPercent(rawCode, plan);
    return { message: "Promo applied", data: promo };
  }

  public async availability(rawSlug: string) {
    let slug: string;
    try {
      slug = validateStudioSlug(rawSlug);
    } catch (error) {
      return {
        message: "Slug check",
        data: {
          available: false,
          reason: error instanceof ApiError ? error.message : "Invalid slug",
        },
      };
    }
    const taken = await this.studio.findUnique({ where: { slug } });
    const pending = taken
      ? null
      : await this.studioSignup.findFirst({
          where: { slug, status: "PENDING" },
        });
    const available = !taken && !pending;
    return {
      message: "Slug check",
      data: {
        slug,
        available,
        ...(available ? {} : { reason: "That address is taken" }),
      },
    };
  }

  // Public billing config for the onboarding wizard: whether the revenue-share
  // option is offered, and its commission % + setup fees per plan.
  public async config() {
    const cfg = await this.platform.getBillingConfig();
    return { message: "Onboarding config", data: cfg };
  }

  /** Email a 6-digit code. Says the same thing whether the email is in use. */
  public async sendEmailCode(rawEmail: unknown) {
    const email = String(rawEmail ?? "")
      .trim()
      .toLowerCase();
    if (!EMAIL_RE.test(email)) {
      throw new ApiError("A valid email is required", HttpCode.BAD_REQUEST);
    }
    await sendEmailCode({ key: email, to: email, brand: platformBrand });
    return { message: "Code sent", data: { email } };
  }

  /** Check a code. A match returns a short-lived proof that start() requires. */
  public async confirmEmailCode(rawEmail: unknown, rawCode: unknown) {
    const email = String(rawEmail ?? "")
      .trim()
      .toLowerCase();
    await confirmEmailCode(email, rawCode);
    return {
      message: "Email confirmed",
      data: {
        emailToken: jwt.sign(
          { purpose: EMAIL_PROOF_PURPOSE, email },
          env.JWT_SECRET,
          { expiresIn: "1h" },
        ),
      },
    };
  }

  private assertEmailProof(token: unknown, email: string) {
    try {
      const proof = jwt.verify(String(token ?? ""), env.JWT_SECRET) as {
        purpose?: string;
        email?: string;
      };
      if (proof.purpose === EMAIL_PROOF_PURPOSE && proof.email === email)
        return;
    } catch {
      /* Falls through to the same error as a mismatch. */
    }
    throw new ApiError("Please confirm your email first", HttpCode.BAD_REQUEST);
  }

  public async start(input: {
    emailToken?: unknown;
    promoCode?: unknown;
    ref?: unknown;
    name?: unknown;
    slug?: unknown;
    ownerEmail?: unknown;
    ownerPassword?: unknown;
    ownerFullName?: unknown;
    plan?: unknown;
    cadence?: unknown;
    billingMode?: unknown;
    shopCategory?: unknown;
  }) {
    const name = String(input.name ?? "").trim();
    if (name.length < 2 || name.length > 60) {
      throw new ApiError(
        "Studio name must be 2-60 characters",
        HttpCode.BAD_REQUEST,
      );
    }
    const slug = validateStudioSlug(String(input.slug ?? ""));
    const ownerEmail = String(input.ownerEmail ?? "")
      .trim()
      .toLowerCase();
    if (!EMAIL_RE.test(ownerEmail)) {
      throw new ApiError("A valid email is required", HttpCode.BAD_REQUEST);
    }
    this.assertEmailProof(input.emailToken, ownerEmail);
    const ownerPassword = String(input.ownerPassword ?? "");
    // Enforce the SAME rules the login/signup validators use, so an owner can
    // actually sign in afterwards with the password they set here.
    if (!PASSWORD_RE.test(ownerPassword)) {
      throw new ApiError(
        "Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character.",
        HttpCode.BAD_REQUEST,
      );
    }
    const plan: Plan = isPlan(input.plan) ? input.plan : "STANDARD";
    // What the shop sells: required for Zuri Stores, optional for
    // Premium's shop, not used by booking-only Standard.
    let shopCategory: ShopCategory | null = null;
    if (plan !== "STANDARD") {
      if (isShopCategory(input.shopCategory)) shopCategory = input.shopCategory;
      else if (plan === "STOREFRONT") {
        throw new ApiError(
          "Tell us what you'll be selling",
          HttpCode.BAD_REQUEST,
        );
      }
    }
    const cadence: Cadence = input.cadence === "YEARLY" ? "YEARLY" : "MONTHLY";

    // Revenue-share is only selectable when the super admin has enabled it;
    // otherwise everyone is on subscription (the default).
    const cfg = await this.platform.getBillingConfig();
    const billingMode: BillingMode =
      input.billingMode === "REVENUE_SHARE" && cfg.revenueShareEnabled
        ? "REVENUE_SHARE"
        : "SUBSCRIPTION";

    // Guard against taken slugs before charging.
    const taken = await this.studio.findUnique({ where: { slug } });
    if (taken) {
      throw new ApiError("That address is already taken", HttpCode.CONFLICT);
    }

    // Amount charged now:
    //  - revenue-share: the plan's one-time activation fee (0 = provisioned
    //    immediately with no payment);
    //  - subscription with a setup fee: the setup fee, which covers the first
    //    `months` months in place of the first period;
    //  - subscription without one: the first period's price.
    const setup =
      billingMode === "SUBSCRIPTION"
        ? subscriptionSetupFor(plan, cadence, cfg)
        : null;
    const listPesewas =
      billingMode === "REVENUE_SHARE"
        ? Math.round(setupFeeFor(plan, cfg) * 100)
        : setup
          ? Math.round(setup.fee * 100)
          : toPesewas(planPriceFor(plan, cadence, cfg));

    if (billingMode === "SUBSCRIPTION" && !listPesewas) {
      throw new ApiError(
        "Billing is not configured for that plan yet. Please contact us.",
        HttpCode.BAD_GATEWAY,
      );
    }
    // A billing promo takes its % off whatever is charged now. The welcome
    // discount (set by the super admin) also applies to a plain first period,
    // but not to a setup or activation fee. They don't stack: the bigger wins.
    const promo = await promoPercent(input.promoCode, plan);
    const welcomePercent =
      billingMode === "SUBSCRIPTION" && !setup
        ? cfg.newStudioDiscountPercent
        : 0;
    const amountPesewas = Math.round(
      listPesewas *
        (1 - Math.min(100, Math.max(promo.percent, welcomePercent)) / 100),
    );

    const reference = `${SIGNUP_PREFIX}${shortId()}`;
    const ownerPasswordHash = await getPasswordHash(ownerPassword);
    const ownerFullName = String(input.ownerFullName ?? "").trim();

    await this.studioSignup.create({
      data: {
        name,
        slug,
        ownerEmail,
        ownerPasswordHash,
        ...(ownerFullName ? { ownerFullName } : {}),
        plan,
        cadence,
        billingMode,
        ...(shopCategory ? { shopCategory } : {}),
        reference,
        ...(promo.code ? { promoCode: promo.code } : {}),
        // An invite link from another business (checked when provisioning).
        ...(typeof input.ref === "string" && /^[a-z0-9-]{2,60}$/.test(input.ref)
          ? { referralSlug: input.ref }
          : {}),
        status: "PENDING",
        // Recorded now, so finalize provisions exactly what was paid for even
        // if the super admin changes the fees in between.
        amountCharged: amountPesewas / 100,
        ...(setup ? { coverageMonths: setup.months } : {}),
      },
    });

    // Nothing to pay (a revenue-share plan with no setup fee, or a 100%
    // promo): provision right away.
    if (!amountPesewas) {
      const done = await this.finalize(reference, { skipPaymentCheck: true });
      return {
        message: "Signup provisioned",
        data: {
          reference,
          provisioned: true,
          slug: done.data.slug ?? slug,
          email: ownerEmail,
        },
      };
    }

    // One-time charge (Mobile Money friendly). Settles to the platform account.
    const init = await paystack.initialize({
      email: ownerEmail,
      amountPesewas,
      reference,
      callbackUrl: `${env.clientUrl}/onboarding/callback`,
      metadata: { kind: "signup", reference, slug, plan, cadence, billingMode },
    });

    return {
      message: "Signup started",
      data: {
        reference,
        accessCode: init.access_code,
        authorizationUrl: init.authorization_url,
        email: ownerEmail,
        publicKey: env.paystack.publicKey,
      },
    };
  }

  /**
   * Idempotently finalize a signup: verify the payment, and on first success
   * provision the studio (in super-admin context). Called by the status poll and
   * by the webhook. Returns the signup's current state.
   */
  public async finalize(
    reference: string,
    opts?: { skipPaymentCheck?: boolean },
  ) {
    const signup = await this.studioSignup.findUnique({ where: { reference } });
    if (!signup) {
      throw new ApiError("Signup not found", HttpCode.NOT_FOUND);
    }
    if (signup.status === "PROVISIONED" && signup.studioId) {
      const studio = await this.studio.findUnique({
        where: { id: signup.studioId },
        select: { slug: true },
      });
      return {
        message: "Ready",
        data: { status: "PROVISIONED", slug: studio?.slug ?? signup.slug },
      };
    }

    // A free revenue-share signup (no setup fee) skips the payment check.
    if (!opts?.skipPaymentCheck) {
      let paid = false;
      try {
        const data = await paystack.verify(reference);
        paid = data.status === "success";
        // Never provision on "success" alone: confirm Paystack collected what
        // this signup was charged (recorded at start).
        if (paid && signup.amountCharged != null) {
          const expected = Math.round(signup.amountCharged * 100);
          if (Number(data.amount) < expected) {
            console.error(
              `Signup ${reference}: Paystack collected ${data.amount} pesewas, expected ${expected}`,
            );
            paid = false;
          }
        }
      } catch {
        paid = false;
      }
      if (!paid) {
        return { message: "Pending", data: { status: signup.status } };
      }
    }

    const plan = signup.plan as Plan;
    const cadence = signup.cadence as Cadence;
    const billingMode = (signup.billingMode as BillingMode) ?? "SUBSCRIPTION";
    const revenueShare = billingMode === "REVENUE_SHARE";
    const cfg = await this.platform.getBillingConfig();

    // Provision once (super-admin context so scoped rows get the new studioId).
    const studio = await runAsSuperAdmin(() =>
      this.platform.provisionStudioCore({
        name: signup.name,
        slug: signup.slug,
        ownerEmail: signup.ownerEmail,
        ownerPasswordHash: signup.ownerPasswordHash,
        // Signups confirm the email with a code before paying.
        ownerEmailVerified: true,
        ...(signup.ownerFullName
          ? { ownerFullName: signup.ownerFullName }
          : {}),
        plan,
        cadence,
        billingMode,
        shopCategory: signup.shopCategory ?? null,
        // Revenue-share: platform takes the plan's commission per transaction and
        // there's no billing period. Subscription: 0% cut, a period is set.
        platformFeePercent: revenueShare ? commissionFor(plan, cfg) : 0,
        // Welcome discount on the plan price for the first months (subscription
        // plans only; revenue-share pays a commission instead).
        welcomeDiscount: revenueShare
          ? null
          : {
              percent: cfg.newStudioDiscountPercent,
              months: cfg.newStudioDiscountMonths,
            },
        // A setup fee covers its months; otherwise the first paid period.
        // Either way the plan's normal price is due when this period ends.
        subscription: revenueShare
          ? { status: "revenue_share", currentPeriodEnd: null }
          : {
              status: "active",
              currentPeriodEnd: signup.coverageMonths
                ? addMonths(new Date(), signup.coverageMonths)
                : addPeriod(new Date(), cadence),
            },
      }),
    );
    await countPromoUse(signup.promoCode);
    // Invited by another business: link them and reward both.
    if (signup.referralSlug && signup.referralSlug !== signup.slug) {
      await rewardBusinessReferral(signup.referralSlug, studio.id).catch((e) =>
        console.warn("Business referral reward failed:", (e as Error).message),
      );
    }

    await this.studioSignup.update({
      where: { id: signup.id },
      data: { status: "PROVISIONED", studioId: studio.id },
    });

    // Per-studio payment audit for the signup charge (setup fee or first period).
    const amount =
      signup.amountCharged ??
      (revenueShare
        ? setupFeeFor(plan, cfg)
        : planPriceFor(plan, cadence, cfg));
    await this.audit.record({
      actor: { email: signup.ownerEmail, role: "customer" },
      action: "payment.signup.succeeded",
      targetType: "Studio",
      targetId: studio.id,
      studioId: studio.id,
      metadata: {
        kind: "signup",
        reference,
        plan,
        cadence,
        billingMode,
        amount,
        ...(signup.coverageMonths
          ? { setupFeeCoversMonths: signup.coverageMonths }
          : {}),
        currency: "GHS",
        ownerEmail: signup.ownerEmail,
      },
    });

    try {
      const websiteUrl = studioLink(studio.slug);
      const { subject, html } = studioCreated(platformBrandForPlan(plan), {
        ownerFirstName: signup.ownerFullName?.split(" ")[0] || "there",
        studioName: studio.name,
        planName: planName(plan),
        dashboardUrl: studioLink(studio.slug, "/admin/login"),
        storefrontUrl: websiteUrl,
        learnUrl: studioLink(studio.slug, "/admin/learn"),
      });
      // The signup charge is a real payment, so it gets a receipt like any
      // other. Revenue-share studios with no setup fee pay nothing here, and
      // a zero-amount receipt would only confuse — so it's attached only when
      // money actually changed hands.
      const signupReceipt =
        amount > 0
          ? buildReceiptPdf({
              studioName: "Zuri",
              title:
                revenueShare || signup.coverageMonths
                  ? "Setup fee receipt"
                  : "Subscription receipt",
              receiptNumber: receiptNumber("RCP", studio.id),
              issuedAt: new Date(),
              heading: `${planName(plan)} plan — ${studio.name}`,
              lines: [
                { label: "Studio", value: studio.name },
                { label: "Account", value: signup.ownerEmail },
                {
                  label: revenueShare ? "Billing" : "Plan period",
                  value: revenueShare
                    ? "Revenue share"
                    : cadence === "YEARLY"
                      ? "Yearly"
                      : "Monthly",
                },
                ...(signup.coverageMonths
                  ? [
                      {
                        label: "Covers",
                        value: `Your first ${signup.coverageMonths} months`,
                      },
                    ]
                  : []),
                { label: "Amount", value: ghs(amount), strong: true },
              ],
              amountPaid: ghs(amount),
              balanceDue: null,
              reference,
              paymentMethod: "Online payment",
              paidToEmail: env.platformEmail,
              status: "PAID",
            })
          : null;

      await this.notifications.send({
        template: NotificationTemplate.STUDIO_CREATED,
        to: signup.ownerEmail,
        subject,
        html,
        studioId: studio.id,
        entityType: "Studio",
        entityId: studio.id,
        ...(signupReceipt
          ? {
              attachments: [
                {
                  filename: signupReceipt.filename,
                  content: signupReceipt.base64,
                  contentType: "application/pdf",
                },
              ],
            }
          : {}),
      });
    } catch (error) {
      console.error("Failed to send studio-created email:", error);
    }

    return {
      message: "Provisioned",
      data: { status: "PROVISIONED", slug: studio.slug },
    };
  }

  public async status(reference: string) {
    // Poll = try to finalize (idempotent) so it works even if the webhook is
    // delayed or unreachable (e.g. local dev).
    const result = await this.finalize(reference);
    if (result.data.status !== "PROVISIONED") return result;
    return {
      ...result,
      data: { ...result.data, summary: await this.signupSummary(reference) },
    };
  }

  /**
   * What the new owner sees on the "your studio is live" screen. Anyone with
   * the payment reference can read this, so it holds nothing private (no
   * email, no account details): the studio, its plan and what was paid.
   */
  private async signupSummary(reference: string) {
    const signup = await this.studioSignup.findUnique({ where: { reference } });
    if (!signup?.studioId) return null;
    const studio = await this.studio.findUnique({
      where: { id: signup.studioId },
      select: {
        name: true,
        slug: true,
        plan: true,
        billingCadence: true,
        billingMode: true,
        platformFeePercent: true,
        currentPeriodEnd: true,
        createdAt: true,
      },
    });
    if (!studio) return null;
    const subscription = studio.billingMode === "SUBSCRIPTION";
    return {
      reference,
      studioName: studio.name,
      slug: studio.slug,
      websiteUrl: studioLink(studio.slug),
      dashboardUrl: studioLink(studio.slug, "/admin/login"),
      plan: studio.plan,
      cadence: studio.billingCadence,
      billingMode: studio.billingMode,
      amountPaid: signup.amountCharged ?? null,
      currency: "GHS",
      paidAt: signup.updatedAt,
      // Subscription: the setup fee covers the first period(s).
      periodStart: subscription ? studio.createdAt : null,
      periodEnd: subscription ? studio.currentPeriodEnd : null,
      coverageMonths: subscription ? (signup.coverageMonths ?? null) : null,
      // Pay-as-you-earn: the platform's cut of each customer payment.
      commissionPercent: subscription ? null : studio.platformFeePercent,
    };
  }
}
