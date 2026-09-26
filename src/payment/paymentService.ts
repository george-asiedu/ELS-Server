import crypto from "crypto";
import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import { env } from "../config/env.config";
import { paystack, PaystackVerifyData } from "./paystackClient";
import { OrderService } from "../order/orderService";
import { OnboardingService, isSignupReference } from "../onboarding/onboardingService";
import { forgetStudioSlug } from "../tenant/studioResolver";
import { AuditService } from "../audit/auditService";
import { LedgerService } from "../ledger/ledgerService";
import { safeClientOrigin } from "../utils/helper";
import { runAsSuperAdmin } from "../tenant/context";
import { NotificationService } from "../notifications/notificationService";
import { NotificationTemplate } from "../notifications/registry";
import { paymentSuccess, paymentFailed } from "../notifications/templates/payment";
import { EmailBrand, MoneyLine } from "../notifications/types";
import {
  ghs,
  receiptDate,
  receiptDayOnly,
  receiptNumber,
} from "../notifications/format";
import { buildReceiptPdf } from "../notifications/receiptPdf";
import { receiptMethodLabel } from "../notifications/design/shell";

type PaymentType = "FULL" | "PARTIAL";

const appointmentInclude = {
  appointment: {
    include: { service: { select: { name: true } } },
  },
} as const;

// Structural type covering just what the receipt needs.
interface PaymentWithAppointment {
  amount: number;
  totalAmount: number;
  type: string;
  reference: string | null;
  studioId: string | null;
  channel?: string | null;
  transactionId?: string | null;
  paidAt?: Date | null;
  appointment: {
    email: string | null;
    fullName: string;
    appointmentDate: Date;
    appointmentTime: string;
    service: { name: string } | null;
  } | null;
}

export class PaymentService extends Connection {
  private notifications = new NotificationService();
  private orders = new OrderService();
  private onboarding = new OnboardingService();
  private audit = new AuditService();
  private ledger = new LedgerService();

  private async settings() {
    const existing = await this.paymentSettings.findFirst();
    return existing ?? (await this.paymentSettings.create({ data: {} }));
  }

  private async userEmail(userId: string) {
    const user = await this.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return user?.email ?? null;
  }

  // Validate a booking payment and (re)create its PENDING Payment row with a
  // fresh reference. Shared by the hosted/inline initialize and the mobile-money
  // charge so both channels behave identically.
  private async prepareBookingCharge(
    appointmentId: string,
    type: PaymentType,
    userId: string,
  ) {
    const appointment = await this.appointment.findUnique({
      where: { id: appointmentId },
      include: { service: { select: { name: true } } },
    });
    if (!appointment) throw new ApiError("Appointment not found", 404);
    if (appointment.userId !== userId) {
      throw new ApiError("You can only pay for your own booking", 403);
    }

    const settings = await this.settings();
    if (!settings.enabled) {
      throw new ApiError("Online payment is not enabled", 400);
    }
    if (type === "FULL" && !settings.allowFull) {
      throw new ApiError("Full payment is not available", 400);
    }
    if (type === "PARTIAL" && !settings.allowPartial) {
      throw new ApiError("Partial (deposit) payment is not available", 400);
    }

    const amountDue =
      (appointment.totalPrice ?? 0) - (appointment.discountAmount ?? 0);
    if (amountDue <= 0) throw new ApiError("Nothing to pay for this booking", 400);

    const charge =
      type === "PARTIAL"
        ? Math.round(amountDue * (settings.depositPercent / 100) * 100) / 100
        : amountDue;
    if (charge <= 0) throw new ApiError("Invalid payment amount", 400);

    const email = appointment.email || (await this.userEmail(userId));
    if (!email) throw new ApiError("An email is required to pay", 400);

    const reference = await this.makeReference("APT");

    // One payment per appointment — reuse the row and refresh the reference so a
    // previously abandoned attempt gets a clean Paystack transaction.
    await this.payment.upsert({
      where: { appointmentId },
      update: {
        amount: charge,
        totalAmount: amountDue,
        type,
        status: "PENDING",
        reference,
        currency: "GHS",
      },
      create: {
        appointmentId,
        amount: charge,
        totalAmount: amountDue,
        type,
        status: "PENDING",
        reference,
        currency: "GHS",
      },
    });

    // Record the attempt against its own immutable reference BEFORE handing it
    // to Paystack. The Payment row's `reference` still rotates on retry, but the
    // attempt row does not — so if this checkout is abandoned and a later one
    // replaces the reference, a webhook for THIS reference can still resolve it.
    const payment = await this.payment.findUnique({
      where: { appointmentId },
      select: { id: true },
    });
    await this.ledger.openAttempt({
      reference,
      expectedAmount: charge,
      currency: "GHS",
      ...(payment ? { paymentId: payment.id } : {}),
      appointmentId,
      customerEmail: email,
      customerName: appointment.fullName,
    });

    return { reference, charge, email, appointmentId, type };
  }

  // Start a Paystack transaction for a customer's own booking. Returns the data
  // the in-app payment dialog needs: reference + amount + email + the studio's
  // subaccount (for the inline popup / split), plus an authorization_url as a
  // hosted-checkout fallback.
  public async initialize(
    appointmentId: string,
    type: PaymentType,
    userId: string,
    origin?: string,
  ) {
    const { reference, charge, email } = await this.prepareBookingCharge(
      appointmentId,
      type,
      userId,
    );
    const subaccount = await this.currentStudioSubaccount();

    const init = await paystack.initialize({
      email,
      amountPesewas: Math.round(charge * 100),
      reference,
      callbackUrl: `${safeClientOrigin(origin)}/payment/callback`,
      metadata: { appointmentId, type },
      subaccount,
    });

    return {
      message: "Payment initialized",
      data: {
        authorizationUrl: init.authorization_url,
        accessCode: init.access_code,
        reference,
        amount: charge,
        email,
        subaccount,
        publicKey: env.paystack.publicKey,
        type,
      },
    };
  }

  // Mobile-money charge for a booking: prompts the customer's phone directly
  // (no hosted checkout). The webhook (or a status poll) finalizes it.
  public async chargeMomoBooking(
    appointmentId: string,
    type: PaymentType,
    userId: string,
    phone: string,
    provider: string,
  ) {
    const { reference, charge, email } = await this.prepareBookingCharge(
      appointmentId,
      type,
      userId,
    );
    const subaccount = await this.currentStudioSubaccount();

    const res = await paystack.chargeMobileMoney({
      email,
      amountPesewas: Math.round(charge * 100),
      reference,
      phone,
      provider,
      subaccount,
      metadata: { appointmentId, type },
    });

    return {
      message: "Charge started",
      data: {
        reference,
        status: res.status,
        displayText: res.display_text ?? res.message ?? null,
        amount: charge,
      },
    };
  }

  // Called from the browser after the Paystack redirect.
  public async verify(reference: string) {
    const data = await paystack.verify(reference);
    const payment = await this.processVerification(reference, data);
    if (!payment) throw new ApiError("Payment not found", 404);
    return { message: "Payment verified", data: payment };
  }

  // Combined booking charge: finalize the service payment AND the linked product
  // order that share one Paystack reference. Either may be absent.
  public async verifyCombined(reference: string) {
    const data = await paystack.verify(reference);
    const payment = await this.processVerification(reference, data);
    const order = await this.orders.finalizeByReference(reference, data);
    if (!payment && !order) {
      throw new ApiError("Transaction not found", 404);
    }
    return { message: "Payment verified", data: { payment, order } };
  }

  // Submit an OTP for a mobile-money charge that requested one.
  public async submitMomoOtp(reference: string, otp: string) {
    const res = await paystack.submitOtp({ reference, otp });
    return {
      message: "OTP submitted",
      data: {
        reference,
        status: res.status,
        displayText: res.display_text ?? res.message ?? null,
      },
    };
  }

  // Poll the outcome of a charge (mobile money or inline). Re-verifies against
  // Paystack and finalizes idempotently (same path as the webhook), so a
  // completed payment is settled even if the webhook is delayed.
  public async chargeStatus(reference: string) {
    let paystackStatus = "pending";
    try {
      const data = await paystack.verify(reference);
      paystackStatus = data.status;
      await this.processVerification(reference, data);
      await this.orders.finalizeByReference(reference, data);
    } catch {
      // Transaction not found yet / still initializing — treat as pending.
    }

    const status =
      paystackStatus === "success"
        ? "success"
        : ["failed", "abandoned", "reversed", "timeout"].includes(paystackStatus)
          ? "failed"
          : "pending";

    return { message: "Charge status", data: { reference, status } };
  }

  // Background sweep (see queue/workers/reconcileWorker.ts, run on a cron
  // schedule): catches payments/orders that never got a final status because
  // the Paystack webhook was lost/delayed and the customer never returned to
  // the callback page to trigger a client-side verify. Runs across every
  // studio, so it must run in the super-admin context (bypasses tenant
  // scoping — see src/tenant/tenantExtension.ts).
  public async reconcilePendingPayments() {
    return runAsSuperAdmin(async () => {
      const now = Date.now();
      // Give a checkout at least 15 minutes before treating it as abandoned —
      // the customer may still be entering their card/MoMo PIN.
      const graceCutoff = new Date(now - 15 * 60 * 1000);
      // Beyond 3 days, Paystack's own transaction has expired; there's nothing
      // left to verify, so these are marked FAILED directly (no API call).
      const deadCutoff = new Date(now - 3 * 24 * 60 * 60 * 1000);

      const [stalePayments, staleOrders, staleAttempts] = await Promise.all([
        this.payment.findMany({
          where: {
            status: "PENDING",
            reference: { not: null },
            createdAt: { lt: graceCutoff, gt: deadCutoff },
          },
          select: { reference: true },
        }),
        this.order.findMany({
          where: {
            status: "PENDING_PAYMENT",
            reference: { not: null },
            createdAt: { lt: graceCutoff, gt: deadCutoff },
          },
          select: { reference: true },
        }),
        // Attempts are the only place an abandoned-then-retried reference still
        // exists: the Payment/Order row has moved on to the newer reference, so
        // the two queries above cannot see it. Sweeping these is what recovers a
        // customer who paid on a checkout they had already walked away from.
        this.paymentAttempt.findMany({
          where: {
            status: "PENDING",
            createdAt: { lt: graceCutoff, gt: deadCutoff },
          },
          select: { reference: true },
        }),
      ]);

      // A combined booking+products charge shares one reference across a
      // Payment and an Order — dedupe so we verify each transaction once.
      const references = new Set(
        [...stalePayments, ...staleOrders, ...staleAttempts]
          .map((r) => r.reference)
          .filter((r): r is string => !!r),
      );

      let recovered = 0; // Paystack now says success — payment/order finalized.
      let failed = 0; // Paystack has a definitive non-success outcome.
      const errors: string[] = [];
      for (const reference of references) {
        try {
          const data = await paystack.verify(reference);
          await this.processVerification(reference, data);
          await this.orders.finalizeByReference(reference, data);
          if (data.status === "success") recovered++;
          else failed++;
        } catch (error) {
          errors.push(
            `${reference}: ${error instanceof Error ? error.message : "unknown error"}`,
          );
        }
      }

      // Anything past the dead cutoff gets marked FAILED without calling
      // Paystack — the transaction window has closed on their side too.
      const [expiredPayments, expiredOrders, expiredAttempts] = await Promise.all([
        this.payment.updateMany({
          where: { status: "PENDING", reference: { not: null }, createdAt: { lte: deadCutoff } },
          data: { status: "FAILED" },
        }),
        this.order.updateMany({
          where: {
            status: "PENDING_PAYMENT",
            reference: { not: null },
            createdAt: { lte: deadCutoff },
          },
          data: { status: "CANCELLED" },
        }),
        this.paymentAttempt.updateMany({
          where: { status: "PENDING", createdAt: { lte: deadCutoff } },
          data: { status: "ABANDONED", failureReason: "Transaction window closed" },
        }),
      ]);

      const result = {
        checked: references.size,
        recovered,
        failed,
        expired: expiredPayments.count + expiredOrders.count,
        expiredAttempts: expiredAttempts.count,
        errors,
      };

      // Only log a run that actually found/changed something — a clean sweep
      // every 15 minutes would otherwise flood the platform activity log.
      if (result.checked > 0 || result.expired > 0) {
        await this.audit.record({
          actor: { email: "system", role: "cron" },
          action: "payments.reconciled",
          metadata: result,
        });
      }

      return result;
    });
  }

  // Shared by verify + webhook. Idempotently marks the payment paid and emails
  // the receipt the first time it transitions to PAID. Returns null when no
  // payment matches the reference (order-only / combined charges).
  private async processVerification(
    reference: string,
    data: PaystackVerifyData,
  ) {
    // Resolve the payment two ways. The direct lookup handles the normal case;
    // the attempt lookup is the safety net for a reference that has since been
    // rotated off the Payment row by a retry (an abandoned checkout the customer
    // later completed on their phone). Without it that money is orphaned.
    const attempt = await this.ledger.findAttempt(reference);
    let payment = await this.payment.findUnique({
      where: { reference },
      include: appointmentInclude,
    });
    if (!payment && attempt?.paymentId) {
      payment = await this.payment.findUnique({
        where: { id: attempt.paymentId },
        include: appointmentInclude,
      });
    }
    if (!payment) return null;

    const succeeded = data.status === "success";

    // What THIS reference was supposed to collect. Falls back to the row's
    // current amount for attempts predating the attempt table.
    const expectedAmount = attempt?.expectedAmount ?? payment.amount;
    const expectedCurrency = attempt?.currency ?? payment.currency ?? "GHS";

    if (succeeded) {
      // Never trust `status: "success"` alone — confirm Paystack charged the
      // amount and currency we asked for before crediting anything.
      const check = this.ledger.assertAmountMatches(
        expectedAmount,
        expectedCurrency,
        data,
      );
      if (!check.ok) {
        await this.ledger.settleAttempt(reference, data, {
          status: "FAILED",
          failureReason: check.reason,
        });
        await this.audit.record({
          actor: { email: payment.appointment?.email ?? "system", role: "system" },
          action: "payment.booking.amount_mismatch",
          targetType: "Payment",
          targetId: payment.id,
          studioId: payment.studioId ?? undefined,
          metadata: {
            reference,
            reason: check.reason,
            expectedAmount,
            reportedAmountPesewas: data.amount,
            transactionId: String(data.id),
          },
        });
        await this.ledger.post({
          studioId: payment.studioId,
          type: "BOOKING_PAYMENT",
          direction: "CREDIT",
          status: "FAILED",
          amount: Number(data.amount ?? 0) / 100,
          currency: expectedCurrency,
          dedupeKey: `booking:mismatch:${reference}`,
          reference,
          transactionId: String(data.id),
          channel: data.channel ?? null,
          description: `Rejected booking payment (${check.reason})`,
          customerName: payment.appointment?.fullName ?? null,
          customerEmail: payment.appointment?.email ?? null,
          paymentId: payment.id,
          appointmentId: payment.appointmentId,
          ...(attempt ? { paymentAttemptId: attempt.id } : {}),
        });
        throw new ApiError(
          "This payment could not be confirmed. Our team has been notified and " +
            "will be in touch — you have not been charged for this booking.",
          400,
        );
      }

      // The booking is already settled by a DIFFERENT reference: this is a
      // genuine second charge, not a replay. Record it as money received that
      // needs refunding rather than silently discarding it.
      if (payment.status === "PAID" && payment.reference !== reference) {
        await this.ledger.settleAttempt(reference, data, { status: "SUCCESS" });
        await this.audit.record({
          actor: { email: payment.appointment?.email ?? "system", role: "system" },
          action: "payment.booking.duplicate_charge",
          targetType: "Payment",
          targetId: payment.id,
          studioId: payment.studioId ?? undefined,
          metadata: {
            reference,
            settledReference: payment.reference,
            amount: expectedAmount,
            transactionId: String(data.id),
            note: "Customer charged twice for one booking — refund required.",
          },
        });
        await this.ledger.post({
          studioId: payment.studioId,
          type: "BOOKING_PAYMENT",
          direction: "CREDIT",
          status: "SUCCESS",
          amount: expectedAmount,
          currency: expectedCurrency,
          dedupeKey: `booking:duplicate:${reference}`,
          reference,
          transactionId: String(data.id),
          channel: data.channel ?? null,
          description: "Duplicate booking payment — refund required",
          customerName: payment.appointment?.fullName ?? null,
          customerEmail: payment.appointment?.email ?? null,
          paymentId: payment.id,
          appointmentId: payment.appointmentId,
          occurredAt: data.paid_at ? new Date(data.paid_at) : null,
          ...(attempt ? { paymentAttemptId: attempt.id } : {}),
        });
        return payment;
      }
    }

    if (succeeded && payment.status !== "PAID") {
      const updated = await this.payment.update({
        where: { id: payment.id },
        data: {
          status: "PAID",
          transactionId: String(data.id),
          channel: data.channel ?? null,
          paidAt: data.paid_at ? new Date(data.paid_at) : new Date(),
        },
        include: appointmentInclude,
      });
      await this.ledger.settleAttempt(reference, data, { status: "SUCCESS" });
      await this.ledger.post({
        studioId: updated.studioId,
        type: "BOOKING_PAYMENT",
        direction: "CREDIT",
        status: "SUCCESS",
        amount: updated.amount,
        currency: updated.currency ?? "GHS",
        dedupeKey: `booking:paid:${reference}`,
        reference,
        transactionId: String(data.id),
        channel: data.channel ?? null,
        description: `${updated.type === "PARTIAL" ? "Deposit" : "Payment"} for ${
          updated.appointment?.service?.name ?? "a service"
        }`,
        customerName: updated.appointment?.fullName ?? null,
        customerEmail: updated.appointment?.email ?? null,
        paymentId: updated.id,
        appointmentId: updated.appointmentId,
        actorEmail: updated.appointment?.email ?? null,
        actorRole: "customer",
        occurredAt: data.paid_at ? new Date(data.paid_at) : null,
        ...(attempt ? { paymentAttemptId: attempt.id } : {}),
      });
      await this.sendReceipt(updated);
      await this.auditPayment("payment.booking.succeeded", updated, data);
      return updated;
    }

    if (!succeeded && payment.status === "PENDING") {
      const failed = await this.payment.update({
        where: { id: payment.id },
        data: { status: "FAILED" },
        include: appointmentInclude,
      });
      await this.ledger.settleAttempt(reference, data, {
        status: data.status === "abandoned" ? "ABANDONED" : "FAILED",
        failureReason: `Paystack reported "${data.status}"`,
      });
      await this.ledger.post({
        studioId: failed.studioId,
        type: "BOOKING_PAYMENT",
        direction: "CREDIT",
        status: data.status === "abandoned" ? "ABANDONED" : "FAILED",
        amount: failed.amount,
        currency: failed.currency ?? "GHS",
        dedupeKey: `booking:failed:${reference}`,
        reference,
        channel: data.channel ?? null,
        description: `Failed payment for ${
          failed.appointment?.service?.name ?? "a service"
        }`,
        customerName: failed.appointment?.fullName ?? null,
        customerEmail: failed.appointment?.email ?? null,
        paymentId: failed.id,
        appointmentId: failed.appointmentId,
        actorEmail: failed.appointment?.email ?? null,
        actorRole: "customer",
        ...(attempt ? { paymentAttemptId: attempt.id } : {}),
      });
      await this.auditPayment("payment.booking.failed", failed, data);
      await this.sendPaymentFailedNotification(failed);
      return failed;
    }

    return payment;
  }

  // Append a per-studio audit entry for a booking payment. Best-effort; the
  // actor is the customer who paid (falling back to "system" for webhooks).
  private async auditPayment(
    action: string,
    payment: {
      id: string;
      studioId: string | null;
      amount: number;
      totalAmount: number;
      type: string;
      currency?: string;
      reference: string | null;
      channel: string | null;
      transactionId: string | null;
      appointmentId?: string;
      appointment: {
        email: string | null;
        fullName: string;
        service: { name: string } | null;
      } | null;
    },
    data: PaystackVerifyData,
  ) {
    await this.audit.record({
      actor: {
        email: payment.appointment?.email ?? "system",
        role: "customer",
      },
      action,
      targetType: "Payment",
      targetId: payment.id,
      studioId: payment.studioId ?? undefined,
      metadata: {
        kind: "booking",
        reference: payment.reference,
        transactionId: payment.transactionId ?? String(data.id),
        amount: payment.amount,
        totalAmount: payment.totalAmount,
        currency: payment.currency ?? "GHS",
        paymentType: payment.type,
        channel: payment.channel ?? data.channel ?? null,
        status: data.status,
        appointmentId: payment.appointmentId,
        customerName: payment.appointment?.fullName ?? null,
        customerEmail: payment.appointment?.email ?? null,
        serviceName: payment.appointment?.service?.name ?? null,
      },
    });
  }

  // `studioIdOverride` is required when called from outside the studio's own
  // request context (e.g. the reconciliation cron, which runs in the
  // super-admin context — see currentStudioBranding's doc comment).
  private async brandForNotification(studioIdOverride?: string | null): Promise<EmailBrand> {
    const studio = await this.currentStudioBranding(studioIdOverride ?? undefined);
    return studio
      ? { kind: "studio", studio }
      : {
          kind: "zuri",
          zuri: { name: "Zuri Studios", websiteUrl: "https://zuristudios.com", supportEmail: "hello@zuristudios.com" },
        };
  }

  private async sendReceipt(
    payment: PaymentWithAppointment & { id: string },
  ) {
    const appt = payment.appointment;
    if (!appt?.email) return;
    try {
      const balance = Math.max(0, payment.totalAmount - payment.amount);
      const isPartial = payment.type === "PARTIAL";
      const lines: MoneyLine[] = [
        { label: "Total", value: ghs(payment.totalAmount) },
        { label: isPartial ? "Deposit paid" : "Amount paid", value: ghs(payment.amount) },
        ...(balance > 0 ? [{ label: "Balance due at studio", value: ghs(balance), muted: true }] : []),
      ];
      const brand = await this.brandForNotification(payment.studioId);
      const paidTo =
        brand.kind === "studio" ? brand.studio.name : brand.zuri.name;
      const paidToEmail =
        brand.kind === "studio" ? brand.studio.email : brand.zuri.supportEmail;
      const { subject, html } = paymentSuccess(brand, {
        customerFirstName: appt.fullName.split(" ")[0] || appt.fullName,
        serviceName: appt.service?.name ?? "your service",
        reference: payment.reference ?? payment.id,
        isPartial,
        lines,
        receipt: {
          receiptNumber: receiptNumber("RCP", payment.id),
          paidOn: receiptDate(payment.paidAt ?? null),
          method: payment.channel ?? null,
          reference: payment.reference ?? payment.id,
          transactionId: payment.transactionId ?? null,
          paidTo,
          paidToEmail: paidToEmail ?? null,
          amountPaid: ghs(payment.amount),
          balanceDue: balance > 0 ? ghs(balance) : null,
        },
        ...(brand.kind === "studio" && brand.studio.bookingUrl ? { viewUrl: brand.studio.bookingUrl } : {}),
      });
      // The receipt travels as a PDF attachment; the email body only points at
      // it. Generated per-send rather than stored, so it always reflects the
      // payment as it stands.
      const pdf = buildReceiptPdf({
        studioName: paidTo,
        primaryColor:
          brand.kind === "studio" ? brand.studio.primaryColor : null,
        title: isPartial ? "Deposit receipt" : "Payment receipt",
        receiptNumber: receiptNumber("RCP", payment.id),
        issuedAt: payment.paidAt ?? new Date(),
        heading: appt.service?.name ?? "Your service",
        lines: [
          { label: "Customer", value: appt.fullName },
          {
            label: "Appointment",
            value: `${receiptDayOnly(appt.appointmentDate)} · ${appt.appointmentTime}`,
          },
          { label: "Total", value: ghs(payment.totalAmount) },
          {
            label: isPartial ? "Deposit paid" : "Amount paid",
            value: ghs(payment.amount),
            strong: true,
          },
        ],
        amountPaid: ghs(payment.amount),
        balanceDue: balance > 0 ? ghs(balance) : null,
        reference: payment.reference ?? payment.id,
        transactionId: payment.transactionId ?? null,
        paymentMethod: receiptMethodLabel(payment.channel ?? null),
        paidToEmail: paidToEmail ?? null,
        status: balance > 0 ? "PARTIALLY_PAID" : "PAID",
      });

      await this.notifications.send({
        template: NotificationTemplate.PAYMENT_SUCCESS,
        to: appt.email,
        subject,
        html,
        studioId: payment.studioId,
        entityType: "Payment",
        entityId: payment.id,
        attachments: [
          {
            filename: pdf.filename,
            content: pdf.base64,
            contentType: "application/pdf",
          },
        ],
      });
    } catch (error) {
      console.error("Failed to send payment receipt email:", error);
    }
  }

  private async sendPaymentFailedNotification(
    payment: PaymentWithAppointment & { id: string },
  ) {
    const appt = payment.appointment;
    if (!appt?.email) return;
    try {
      const brand = await this.brandForNotification(payment.studioId);
      const { subject, html } = paymentFailed(brand, {
        customerFirstName: appt.fullName.split(" ")[0] || appt.fullName,
        serviceName: appt.service?.name ?? "your service",
        amountAttempted: ghs(payment.amount),
        reference: payment.reference ?? payment.id,
        ...(brand.kind === "studio" && brand.studio.bookingUrl ? { retryUrl: brand.studio.bookingUrl } : {}),
      });
      await this.notifications.send({
        template: NotificationTemplate.PAYMENT_FAILED,
        to: appt.email,
        subject,
        html,
        studioId: payment.studioId,
        entityType: "Payment",
        entityId: payment.id,
      });
    } catch (error) {
      console.error("Failed to send payment-failed email:", error);
    }
  }

  // Paystack server-to-server notification. Signature-verified, then re-verified
  // against Paystack before trusting it.
  public async handleWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ) {
    if (!rawBody) throw new ApiError("Invalid webhook payload", 400);
    const hash = crypto
      .createHmac("sha512", env.paystack.secretKey)
      .update(rawBody)
      .digest("hex");
    if (!signature || hash !== signature) {
      throw new ApiError("Invalid webhook signature", 401);
    }

    const event = JSON.parse(rawBody.toString("utf8"));
    const type: string = event?.event ?? "";
    const data = event?.data ?? {};

    try {
      if (type === "charge.success" && data.reference) {
        const reference: string = data.reference;
        if (isSignupReference(reference)) {
          // A studio-subscription first payment → provision the studio.
          await this.onboarding.finalize(reference);
        } else {
          // Appointment payments, product orders, and combined booking+product
          // charges (which share a reference) — finalize both; each is a no-op
          // when nothing matches.
          const vd = await paystack.verify(reference);
          await this.processVerification(reference, vd);
          await this.orders.finalizeByReference(reference, vd);
        }
      } else if (type.startsWith("subscription.") || type.startsWith("invoice.")) {
        await this.handleBillingEvent(type, data);
      }
    } catch (error) {
      console.error("Webhook processing error:", error);
    }
    return { received: true };
  }

  // Keep a studio's subscription status in sync with Paystack billing events.
  // Runs in the webhook's super-admin context, so studio/user reads are unscoped.
  private async handleBillingEvent(
    type: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any,
  ) {
    if (type === "subscription.create") {
      const email = String(data?.customer?.email ?? "").toLowerCase();
      const studio = await this.findStudioByOwnerEmail(email);
      if (!studio) return;
      const nextPay = data?.next_payment_date
        ? new Date(data.next_payment_date)
        : null;
      await this.studio.update({
        where: { id: studio.id },
        data: {
          subscriptionCode: data?.subscription_code ?? null,
          subscriptionStatus: "active",
          ...(nextPay ? { currentPeriodEnd: nextPay } : {}),
        },
      });
      return;
    }

    const subCode = data?.subscription_code ?? data?.subscription?.subscription_code;
    const studio = subCode
      ? await this.studio.findFirst({ where: { subscriptionCode: subCode } })
      : null;
    if (!studio) return;

    if (type === "subscription.disable") {
      await this.studio.update({
        where: { id: studio.id },
        data: { subscriptionStatus: "cancelled", status: "SUSPENDED" },
      });
      forgetStudioSlug(studio.slug);
    } else if (type === "subscription.not_renew") {
      await this.studio.update({
        where: { id: studio.id },
        data: { subscriptionStatus: "non-renewing" },
      });
    } else if (type === "invoice.payment_failed") {
      await this.studio.update({
        where: { id: studio.id },
        data: { subscriptionStatus: "past_due" },
      });
      const failedRef = String(
        data?.reference ?? data?.invoice_code ?? data?.id ?? "",
      );
      if (failedRef) {
        const amt = Number(data?.amount ?? 0);
        await this.ledger.post({
          studioId: studio.id,
          type: "SUBSCRIPTION_PAYMENT",
          direction: "DEBIT",
          status: "FAILED",
          amount: Number.isFinite(amt) ? amt / 100 : 0,
          currency: String(data?.currency ?? "GHS").toUpperCase(),
          dedupeKey: `subscription:failed:${failedRef}`,
          reference: failedRef,
          description: "Subscription renewal failed",
          actorRole: "studio",
        });
      }
    } else if (type === "invoice.update" || type === "invoice.create") {
      // Renewal invoice — if paid, keep active and reactivate a suspended studio.
      if (data?.paid === true || data?.status === "success") {
        const nextPay = data?.subscription?.next_payment_date
          ? new Date(data.subscription.next_payment_date)
          : null;

        // A renewal the studio paid us — money out from the studio's point of
        // view, so it lands on the ledger as a DEBIT. Dedupe on the invoice
        // reference so a replayed invoice.update cannot post it twice.
        const invoiceRef = String(
          data?.reference ?? data?.invoice_code ?? data?.id ?? "",
        );
        if (invoiceRef) {
          const paidPesewas = Number(data?.amount ?? 0);
          await this.ledger.post({
            studioId: studio.id,
            type: "SUBSCRIPTION_PAYMENT",
            direction: "DEBIT",
            status: "SUCCESS",
            amount: Number.isFinite(paidPesewas) ? paidPesewas / 100 : 0,
            currency: String(data?.currency ?? "GHS").toUpperCase(),
            dedupeKey: `subscription:paid:${invoiceRef}`,
            reference: invoiceRef,
            description: "Subscription renewal",
            actorEmail: data?.customer?.email ?? null,
            actorRole: "studio",
            occurredAt: data?.paid_at ? new Date(data.paid_at) : null,
          });
        }
        await this.studio.update({
          where: { id: studio.id },
          data: {
            subscriptionStatus: "active",
            ...(studio.status === "SUSPENDED" ? { status: "ACTIVE" } : {}),
            ...(nextPay ? { currentPeriodEnd: nextPay } : {}),
          },
        });
        forgetStudioSlug(studio.slug);
      }
    }
  }

  private async findStudioByOwnerEmail(email: string) {
    if (!email) return null;
    const admin = await this.user.findFirst({
      where: { email, role: "ADMIN" },
      orderBy: { createdAt: "desc" },
      select: { studioId: true },
    });
    if (!admin?.studioId) return null;
    return this.studio.findUnique({ where: { id: admin.studioId } });
  }
}
