import crypto from "crypto";
import { randomUUID } from "crypto";
import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import { env } from "../config/env.config";
import { paystack, PaystackVerifyData } from "./paystackClient";
import { EmailService } from "../email/emailService";
import { OrderService } from "../order/orderService";

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
  appointment: {
    email: string | null;
    fullName: string;
    appointmentDate: Date;
    appointmentTime: string;
    service: { name: string } | null;
  } | null;
}

export class PaymentService extends Connection {
  private email = new EmailService();
  private orders = new OrderService();

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

    const reference = `ELS-${randomUUID()}`;

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
      callbackUrl: `${env.clientUrl}/payment/callback`,
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

  // Shared by verify + webhook. Idempotently marks the payment paid and emails
  // the receipt the first time it transitions to PAID. Returns null when no
  // payment matches the reference (order-only / combined charges).
  private async processVerification(
    reference: string,
    data: PaystackVerifyData,
  ) {
    const payment = await this.payment.findUnique({
      where: { reference },
      include: appointmentInclude,
    });
    if (!payment) return null;

    const succeeded = data.status === "success";

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
      await this.sendReceipt(updated);
      return updated;
    }

    if (!succeeded && payment.status === "PENDING") {
      return this.payment.update({
        where: { id: payment.id },
        data: { status: "FAILED" },
        include: appointmentInclude,
      });
    }

    return payment;
  }

  private async sendReceipt(payment: PaymentWithAppointment) {
    const appt = payment.appointment;
    if (!appt?.email) return;
    const balance = Math.max(0, payment.totalAmount - payment.amount);
    try {
      await this.email.sendPaymentReceipt(appt.email, {
        fullName: appt.fullName,
        serviceName: appt.service?.name ?? "your service",
        reference: payment.reference ?? "",
        amountPaid: payment.amount,
        totalAmount: payment.totalAmount,
        type: payment.type as PaymentType,
        balance,
        date: appt.appointmentDate.toISOString().slice(0, 10),
        time: appt.appointmentTime,
      });
    } catch (error) {
      console.error("Failed to send payment receipt email:", error);
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
    if (event?.event === "charge.success" && event?.data?.reference) {
      const reference: string = event.data.reference;
      try {
        const data = await paystack.verify(reference);
        // One webhook covers appointment payments, product orders, and combined
        // booking+product charges (which share a reference) — finalize both;
        // each is a no-op when nothing matches.
        await this.processVerification(reference, data);
        await this.orders.finalizeByReference(reference, data);
      } catch (error) {
        console.error("Webhook processing error:", error);
      }
    }
    return { received: true };
  }
}
