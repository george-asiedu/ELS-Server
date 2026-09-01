import { randomUUID } from "crypto";
import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import { HttpCode } from "../models/status_codes";
import { env } from "../config/env.config";
import { getPasswordHash } from "../utils/helper";
import { runAsSuperAdmin } from "../tenant/context";
import { paystack } from "../payment/paystackClient";
import {
  PlatformService,
  validateStudioSlug,
  commissionFor,
  setupFeeFor,
} from "../platform/platformService";
import {
  Plan,
  Cadence,
  pricePesewas,
  addPeriod,
} from "../billing/billingPlans";

type BillingMode = "SUBSCRIPTION" | "REVENUE_SHARE";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  public async start(input: {
    name?: unknown;
    slug?: unknown;
    ownerEmail?: unknown;
    ownerPassword?: unknown;
    ownerFullName?: unknown;
    plan?: unknown;
    cadence?: unknown;
    billingMode?: unknown;
  }) {
    const name = String(input.name ?? "").trim();
    if (name.length < 2 || name.length > 60) {
      throw new ApiError("Studio name must be 2-60 characters", HttpCode.BAD_REQUEST);
    }
    const slug = validateStudioSlug(String(input.slug ?? ""));
    const ownerEmail = String(input.ownerEmail ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(ownerEmail)) {
      throw new ApiError("A valid email is required", HttpCode.BAD_REQUEST);
    }
    const ownerPassword = String(input.ownerPassword ?? "");
    if (ownerPassword.length < 8) {
      throw new ApiError("Password must be at least 8 characters", HttpCode.BAD_REQUEST);
    }
    const plan: Plan = input.plan === "PREMIUM" ? "PREMIUM" : "STANDARD";
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

    // Amount charged now: the plan's period price (subscription) or the plan's
    // one-time setup fee (revenue-share). A revenue-share setup fee of 0 means
    // the studio is provisioned immediately with no payment.
    const amountPesewas =
      billingMode === "REVENUE_SHARE"
        ? Math.round(setupFeeFor(plan, cfg) * 100)
        : pricePesewas(plan, cadence);

    if (billingMode === "SUBSCRIPTION" && !amountPesewas) {
      throw new ApiError(
        "Billing is not configured for that plan yet. Please contact us.",
        HttpCode.BAD_GATEWAY,
      );
    }

    const reference = `${SIGNUP_PREFIX}${randomUUID()}`;
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
        reference,
        status: "PENDING",
      },
    });

    // Free revenue-share signup (no setup fee): provision right away.
    if (billingMode === "REVENUE_SHARE" && !amountPesewas) {
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
        ...(signup.ownerFullName ? { ownerFullName: signup.ownerFullName } : {}),
        plan,
        cadence,
        billingMode,
        // Revenue-share: platform takes the plan's commission per transaction and
        // there's no billing period. Subscription: 0% cut, a period is set.
        platformFeePercent: revenueShare ? commissionFor(plan, cfg) : 0,
        subscription: revenueShare
          ? { status: "revenue_share", currentPeriodEnd: null }
          : { status: "active", currentPeriodEnd: addPeriod(new Date(), cadence) },
      }),
    );

    await this.studioSignup.update({
      where: { id: signup.id },
      data: { status: "PROVISIONED", studioId: studio.id },
    });

    return {
      message: "Provisioned",
      data: { status: "PROVISIONED", slug: studio.slug },
    };
  }

  public async status(reference: string) {
    // Poll = try to finalize (idempotent) so it works even if the webhook is
    // delayed or unreachable (e.g. local dev).
    return this.finalize(reference);
  }
}
