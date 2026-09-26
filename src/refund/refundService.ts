import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import { paystack } from "../payment/paystackClient";
import { AuditService } from "../audit/auditService";
import { LedgerService } from "../ledger/ledgerService";
import { NotificationService } from "../notifications/notificationService";
import { NotificationTemplate } from "../notifications/registry";
import { refundProcessed, refundFailed } from "../notifications/templates/refund";
import { buildReceiptPdf } from "../notifications/receiptPdf";
import { ghs, receiptDate, receiptNumber } from "../notifications/format";
import { EmailBrand, MoneyLine } from "../notifications/types";
import { env } from "../config/env.config";

export interface RefundActor {
  id?: string | null;
  email?: string;
  role?: string;
}

// Money comparisons happen in pesewas (integers) so float representation can
// never let a refund creep a fraction over what was collected.
const toPesewas = (n: number) => Math.round(n * 100);

export class RefundService extends Connection {
  private audit = new AuditService();
  private ledger = new LedgerService();
  private notifications = new NotificationService();

  private async brandFor(studioId?: string | null): Promise<EmailBrand> {
    const studio = await this.currentStudioBranding(studioId ?? undefined);
    return studio
      ? { kind: "studio", studio }
      : {
          kind: "zuri",
          zuri: {
            name: "Zuri Studios",
            websiteUrl: env.clientUrl,
            supportEmail: env.senderEmail,
          },
        };
  }

  /**
   * Issue a refund against a booking payment.
   *
   * `amount` omitted refunds everything still refundable. The guard below is
   * the important part: a payment can be refunded more than once (partials), so
   * the ceiling is what was COLLECTED minus what has ALREADY been refunded —
   * not the payment amount — or a studio could refund the same money twice.
   */
  public async refundPayment(
    paymentId: string,
    actor: RefundActor,
    input: { amount?: number; reason?: string } = {},
  ) {
    const payment = await this.payment.findUnique({
      where: { id: paymentId },
      include: {
        appointment: {
          include: { service: { select: { name: true } } },
        },
      },
    });
    if (!payment) throw new ApiError("Payment not found", 404);
    // REFUNDED is allowed through this gate on purpose: the refundable-amount
    // check below produces the accurate "already fully refunded" message,
    // whereas rejecting here would blame the payment's state instead.
    const settled = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"];
    if (!settled.includes(payment.status)) {
      throw new ApiError("Only a settled payment can be refunded", 400);
    }
    if (!payment.reference) {
      throw new ApiError(
        "This payment has no provider reference, so it can't be refunded automatically",
        400,
      );
    }

    const alreadyRefunded = payment.refundedAmount ?? 0;
    const refundable =
      Math.round((payment.amount - alreadyRefunded) * 100) / 100;
    if (refundable <= 0) {
      throw new ApiError("This payment has already been fully refunded", 400);
    }

    const amount = input.amount ?? refundable;
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ApiError("Refund amount must be greater than 0", 400);
    }
    if (toPesewas(amount) > toPesewas(refundable)) {
      throw new ApiError(
        `Refund exceeds what's left on this payment (${ghs(refundable)} refundable)`,
        400,
      );
    }

    const reference = await this.makeReference("RF");
    const appt = payment.appointment;

    const refund = await this.refund.create({
      data: {
        reference,
        amount,
        currency: payment.currency ?? "GHS",
        status: "PENDING",
        paymentId: payment.id,
        appointmentId: payment.appointmentId,
        ...(payment.transactionId ? { transactionId: payment.transactionId } : {}),
        ...(input.reason ? { reason: input.reason.trim() } : {}),
        ...(appt?.fullName ? { customerName: appt.fullName } : {}),
        ...(appt?.email ? { customerEmail: appt.email } : {}),
        ...(actor.email ? { initiatedByEmail: actor.email } : {}),
        ...(actor.role ? { initiatedByRole: actor.role } : {}),
      },
    });

    await this.audit.record({
      actor,
      action: "refund.requested",
      targetType: "Refund",
      targetId: refund.id,
      studioId: payment.studioId ?? undefined,
      metadata: {
        kind: "booking",
        reference,
        paymentId: payment.id,
        amount,
        refundableBefore: refundable,
        reason: input.reason ?? null,
      },
    });

    // Ask Paystack to reverse it. A provider failure marks the row FAILED and
    // surfaces the error rather than leaving a PENDING row nobody chases.
    try {
      const res = await paystack.refund({
        transactionReference: payment.reference,
        amountPesewas: toPesewas(amount),
        ...(input.reason ? { reason: input.reason } : {}),
      });
      await this.refund.update({
        where: { id: refund.id },
        data: { providerRefundId: String(res.id) },
      });
      // Paystack usually returns "pending" and confirms by webhook; when it
      // comes back already processed, settle immediately.
      if (res.status === "processed" || res.status === "success") {
        return {
          message: "Refund processed",
          data: await this.settle(reference, "PROCESSED"),
        };
      }
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Provider rejected the refund";
      await this.refund.update({
        where: { id: refund.id },
        data: { status: "FAILED", failureReason: reason },
      });
      await this.audit.record({
        actor,
        action: "refund.failed",
        targetType: "Refund",
        targetId: refund.id,
        studioId: payment.studioId ?? undefined,
        metadata: { reference, amount, reason },
      });
      throw new ApiError(`Refund could not be started: ${reason}`, 502);
    }

    return {
      message:
        "Refund submitted. It usually completes within a few minutes, and the customer is emailed once it does.",
      data: await this.refund.findUnique({ where: { id: refund.id } }),
    };
  }

  /** Same flow for a shop order. */
  public async refundOrder(
    orderId: string,
    actor: RefundActor,
    input: { amount?: number; reason?: string } = {},
  ) {
    const order = await this.order.findUnique({ where: { id: orderId } });
    if (!order) throw new ApiError("Order not found", 404);
    if (order.status !== "PAID" && order.status !== "FULFILLED") {
      throw new ApiError("Only a paid order can be refunded", 400);
    }
    if (!order.reference) {
      throw new ApiError(
        "This order has no provider reference, so it can't be refunded automatically",
        400,
      );
    }

    const alreadyRefunded = order.refundedAmount ?? 0;
    const refundable = Math.round((order.total - alreadyRefunded) * 100) / 100;
    if (refundable <= 0) {
      throw new ApiError("This order has already been fully refunded", 400);
    }

    const amount = input.amount ?? refundable;
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ApiError("Refund amount must be greater than 0", 400);
    }
    if (toPesewas(amount) > toPesewas(refundable)) {
      throw new ApiError(
        `Refund exceeds what's left on this order (${ghs(refundable)} refundable)`,
        400,
      );
    }

    const reference = await this.makeReference("RF");
    const refund = await this.refund.create({
      data: {
        reference,
        amount,
        currency: "GHS",
        status: "PENDING",
        orderId: order.id,
        ...(order.transactionId ? { transactionId: order.transactionId } : {}),
        ...(input.reason ? { reason: input.reason.trim() } : {}),
        ...(order.customerName ? { customerName: order.customerName } : {}),
        ...(order.customerEmail ? { customerEmail: order.customerEmail } : {}),
        ...(actor.email ? { initiatedByEmail: actor.email } : {}),
        ...(actor.role ? { initiatedByRole: actor.role } : {}),
      },
    });

    await this.audit.record({
      actor,
      action: "refund.requested",
      targetType: "Refund",
      targetId: refund.id,
      studioId: order.studioId ?? undefined,
      metadata: {
        kind: "order",
        reference,
        orderId: order.id,
        orderNumber: order.orderNumber,
        amount,
        reason: input.reason ?? null,
      },
    });

    try {
      const res = await paystack.refund({
        transactionReference: order.reference,
        amountPesewas: toPesewas(amount),
        ...(input.reason ? { reason: input.reason } : {}),
      });
      await this.refund.update({
        where: { id: refund.id },
        data: { providerRefundId: String(res.id) },
      });
      if (res.status === "processed" || res.status === "success") {
        return {
          message: "Refund processed",
          data: await this.settle(reference, "PROCESSED"),
        };
      }
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Provider rejected the refund";
      await this.refund.update({
        where: { id: refund.id },
        data: { status: "FAILED", failureReason: reason },
      });
      throw new ApiError(`Refund could not be started: ${reason}`, 502);
    }

    return {
      message:
        "Refund submitted. It usually completes within a few minutes, and the customer is emailed once it does.",
      data: await this.refund.findUnique({ where: { id: refund.id } }),
    };
  }

  /**
   * Apply a terminal outcome to a refund. Called from the Paystack webhook and
   * from the immediate path above.
   *
   * Idempotent: a refund already in a terminal state is returned untouched, so
   * a replayed webhook cannot decrement `refundedAmount` twice or send the
   * customer a second email.
   */
  public async settle(
    reference: string,
    outcome: "PROCESSED" | "FAILED",
    failureReason?: string | null,
  ) {
    const refund = await this.refund.findUnique({ where: { reference } });
    if (!refund) return null;
    if (refund.status !== "PENDING") return refund;

    const updated = await this.refund.update({
      where: { id: refund.id },
      data: {
        status: outcome,
        ...(outcome === "PROCESSED" ? { processedAt: new Date() } : {}),
        ...(failureReason ? { failureReason } : {}),
      },
    });

    if (outcome === "FAILED") {
      await this.audit.record({
        actor: { email: "system", role: "system" },
        action: "refund.failed",
        targetType: "Refund",
        targetId: refund.id,
        studioId: refund.studioId ?? undefined,
        metadata: { reference, amount: refund.amount, reason: failureReason ?? null },
      });
      await this.notifyFailed(updated);
      return updated;
    }

    // Roll the running total forward and move the source row's status.
    if (refund.paymentId) {
      const payment = await this.payment.findUnique({
        where: { id: refund.paymentId },
      });
      if (payment) {
        const total =
          Math.round(((payment.refundedAmount ?? 0) + refund.amount) * 100) / 100;
        await this.payment.update({
          where: { id: payment.id },
          data: {
            refundedAmount: total,
            status:
              toPesewas(total) >= toPesewas(payment.amount)
                ? "REFUNDED"
                : "PARTIALLY_REFUNDED",
          },
        });
      }
    }
    if (refund.orderId) {
      const order = await this.order.findUnique({ where: { id: refund.orderId } });
      if (order) {
        const total =
          Math.round(((order.refundedAmount ?? 0) + refund.amount) * 100) / 100;
        await this.order.update({
          where: { id: order.id },
          data: { refundedAmount: total },
        });
      }
    }

    // Money leaving the studio: a DEBIT, deduped on the refund reference.
    await this.ledger.post({
      studioId: refund.studioId,
      type: "REFUND",
      direction: "DEBIT",
      status: "SUCCESS",
      amount: refund.amount,
      currency: refund.currency,
      dedupeKey: `refund:processed:${reference}`,
      reference,
      description: refund.reason
        ? `Refund — ${refund.reason}`
        : "Refund to customer",
      customerName: refund.customerName,
      customerEmail: refund.customerEmail,
      paymentId: refund.paymentId,
      orderId: refund.orderId,
      appointmentId: refund.appointmentId,
      actorEmail: refund.initiatedByEmail,
      actorRole: refund.initiatedByRole ?? "studio",
      occurredAt: new Date(),
    });

    await this.audit.record({
      actor: { email: refund.initiatedByEmail ?? "system", role: "system" },
      action: "refund.processed",
      targetType: "Refund",
      targetId: refund.id,
      studioId: refund.studioId ?? undefined,
      metadata: { reference, amount: refund.amount },
    });

    await this.notifyProcessed(updated);
    return updated;
  }

  // ---- Customer notifications (best-effort) -----------------------------

  private async notifyProcessed(refund: {
    id: string;
    reference: string;
    amount: number;
    currency: string;
    reason: string | null;
    studioId: string | null;
    paymentId: string | null;
    orderId: string | null;
    customerName: string | null;
    customerEmail: string | null;
    transactionId: string | null;
    processedAt: Date | null;
  }) {
    if (!refund.customerEmail) return;
    try {
      const brand = await this.brandFor(refund.studioId);
      const paidTo = brand.kind === "studio" ? brand.studio.name : brand.zuri.name;
      const paidToEmail =
        brand.kind === "studio" ? brand.studio.email : brand.zuri.supportEmail;

      // Reconstruct the original figures so the customer can see what they paid
      // and what is left standing after this refund.
      let originalPaid = refund.amount;
      let totalRefunded = refund.amount;
      let what = "your booking";
      if (refund.paymentId) {
        const p = await this.payment.findUnique({
          where: { id: refund.paymentId },
          include: { appointment: { include: { service: { select: { name: true } } } } },
        });
        if (p) {
          originalPaid = p.amount;
          totalRefunded = p.refundedAmount ?? refund.amount;
          const svc = p.appointment?.service?.name;
          what = svc ? `your ${svc} appointment` : "your appointment";
        }
      } else if (refund.orderId) {
        const o = await this.order.findUnique({ where: { id: refund.orderId } });
        if (o) {
          originalPaid = o.total;
          totalRefunded = o.refundedAmount ?? refund.amount;
          what = `order ${o.orderNumber}`;
        }
      }
      const stillPaid = Math.max(0, Math.round((originalPaid - totalRefunded) * 100) / 100);
      const isPartial = toPesewas(totalRefunded) < toPesewas(originalPaid);

      const lines: MoneyLine[] = [
        { label: "Originally paid", value: ghs(originalPaid) },
        { label: "Refunded now", value: ghs(refund.amount), emphasis: true },
        ...(isPartial
          ? [{ label: "Still paid", value: ghs(stillPaid), muted: true }]
          : []),
      ];

      const pdf = buildReceiptPdf({
        studioName: paidTo,
        primaryColor: brand.kind === "studio" ? brand.studio.primaryColor : null,
        title: isPartial ? "Partial refund receipt" : "Refund receipt",
        receiptNumber: receiptNumber("RF", refund.id),
        issuedAt: refund.processedAt ?? new Date(),
        heading: `Refund for ${what}`,
        lines: [
          ...(refund.customerName
            ? [{ label: "Customer", value: refund.customerName }]
            : []),
          { label: "Originally paid", value: ghs(originalPaid) },
          { label: "Refunded", value: ghs(refund.amount), strong: true },
          ...(isPartial ? [{ label: "Still paid", value: ghs(stillPaid) }] : []),
          ...(refund.reason ? [{ label: "Reason", value: refund.reason }] : []),
        ],
        amountPaid: ghs(refund.amount),
        balanceDue: null,
        reference: refund.reference,
        transactionId: refund.transactionId,
        paymentMethod: "Refunded to original payment method",
        paidToEmail: paidToEmail ?? null,
        status: "PAID",
      });

      const receipt: ReceiptLike = {
        receiptNumber: receiptNumber("RF", refund.id),
        paidOn: receiptDate(refund.processedAt ?? new Date()),
        method: null,
        reference: refund.reference,
        transactionId: refund.transactionId,
        paidTo,
        paidToEmail: paidToEmail ?? null,
        amountPaid: ghs(refund.amount),
        balanceDue: null,
      };

      const { subject, html } = refundProcessed(brand, {
        ...(refund.customerName
          ? { customerFirstName: refund.customerName.split(" ")[0] ?? refund.customerName }
          : {}),
        subject: what,
        isPartial,
        lines,
        refundAmount: ghs(refund.amount),
        reason: refund.reason,
        receipt,
        ...(brand.kind === "studio" && brand.studio.bookingUrl
          ? { viewUrl: brand.studio.bookingUrl }
          : {}),
      });

      await this.notifications.send({
        template: NotificationTemplate.REFUND_PROCESSED,
        to: refund.customerEmail,
        subject,
        html,
        studioId: refund.studioId,
        entityType: "Refund",
        entityId: refund.id,
        attachments: [
          {
            filename: pdf.filename,
            content: pdf.base64,
            contentType: "application/pdf",
          },
        ],
      });
    } catch (error) {
      console.error("Failed to send refund email:", error);
    }
  }

  private async notifyFailed(refund: {
    id: string;
    reference: string;
    amount: number;
    studioId: string | null;
    customerName: string | null;
    customerEmail: string | null;
    failureReason: string | null;
  }) {
    if (!refund.customerEmail) return;
    try {
      const brand = await this.brandFor(refund.studioId);
      const support =
        brand.kind === "studio" ? brand.studio.email : brand.zuri.supportEmail;
      const { subject, html } = refundFailed(brand, {
        ...(refund.customerName
          ? { customerFirstName: refund.customerName.split(" ")[0] ?? refund.customerName }
          : {}),
        subject: "your recent payment",
        refundAmount: ghs(refund.amount),
        reference: refund.reference,
        failureReason: refund.failureReason,
        supportEmail: support ?? null,
      });
      await this.notifications.send({
        template: NotificationTemplate.REFUND_FAILED,
        to: refund.customerEmail,
        subject,
        html,
        studioId: refund.studioId,
        entityType: "Refund",
        entityId: `${refund.id}:failed`,
      });
    } catch (error) {
      console.error("Failed to send refund-failure email:", error);
    }
  }

  // ---- Reads ------------------------------------------------------------

  public async findByReference(reference: string) {
    return this.refund.findUnique({ where: { reference } });
  }

  /** For webhooks that echo only Paystack's own refund id. */
  public async findByProviderId(providerRefundId: string) {
    return this.refund.findFirst({ where: { providerRefundId } });
  }

  public async list(opts: { limit?: number; status?: string } = {}) {
    const take = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const refunds = await this.refund.findMany({
      ...(opts.status ? { where: { status: opts.status as "PENDING" } } : {}),
      orderBy: { createdAt: "desc" },
      take,
    });
    return { message: "Refunds", data: refunds };
  }
}

// Structural mirror of ReceiptDetails, imported indirectly to avoid a cycle.
type ReceiptLike = Parameters<typeof refundProcessed>[1]["receipt"];
