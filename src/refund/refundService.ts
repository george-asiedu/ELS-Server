import { Connection, TenantTx } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import { paystack } from "../payment/paystackClient";
import { AuditService } from "../audit/auditService";
import { LedgerService } from "../ledger/ledgerService";
import { NotificationService } from "../notifications/notificationService";
import { NotificationTemplate } from "../notifications/registry";
import { refundProcessed, refundFailed } from "../notifications/templates/refund";
import { buildReceiptPdf } from "../notifications/receiptPdf";
import { ghs, receiptDate, receiptNumber } from "../notifications/format";
import { platformBrand } from "../notifications/brand";
import { MoneyLine } from "../notifications/types";

export interface RefundActor {
  id?: string | null;
  email?: string;
  role?: string;
}

// Money comparisons happen in pesewas (integers) so float representation can
// never let a refund creep a fraction over what was collected.
const toPesewas = (n: number) => Math.round(n * 100);
const round2 = (n: number) => Math.round(n * 100) / 100;

// What a refund is drawn against. A booking refund draws on its Payment, a
// shop refund on its Order; the lock key is per source so refunds against
// different payments never wait on each other.
type RefundSource =
  | { kind: "payment"; id: string }
  | { kind: "order"; id: string };
const sourceLockKey = (source: RefundSource) => `refund-source:${source.kind}:${source.id}`;

export class RefundService extends Connection {
  private audit = new AuditService();
  private ledger = new LedgerService();
  private notifications = new NotificationService();

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

    const reference = await this.makeReference("RF");
    const appt = payment.appointment;

    const { amount, refundable, refund } = await this.reserveRefund(
      { kind: "payment", id: payment.id },
      input.amount,
      (tx, amount) =>
        tx.refund.create({
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
        }),
    );

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

    const reference = await this.makeReference("RF");
    const { amount, refund } = await this.reserveRefund(
      { kind: "order", id: order.id },
      input.amount,
      (tx, amount) =>
        tx.refund.create({
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
        }),
    );

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
   * Work out what is still refundable on `source` and write the PENDING refund
   * row (via `create`) as one locked step.
   *
   * The ceiling is what was collected, minus what has already been refunded,
   * minus refunds still in flight. Counting in-flight refunds matters because
   * `refundedAmount` only moves when a refund settles: without it, a second
   * full refund issued while the first was still pending at Paystack would
   * pass the check. The lock stops two concurrent requests both passing it.
   */
  private reserveRefund<R extends { id: string }>(
    source: RefundSource,
    requested: number | undefined,
    create: (tx: TenantTx, amount: number) => Promise<R>,
  ): Promise<{ amount: number; refundable: number; refund: R }> {
    return this.withAdvisoryLock(sourceLockKey(source), async (tx) => {
      const totals =
        source.kind === "payment"
          ? await tx.payment
              .findFirst({ where: { id: source.id }, select: { amount: true, refundedAmount: true } })
              .then((p) => p && { collected: p.amount, refunded: p.refundedAmount ?? 0 })
          : await tx.order
              .findFirst({ where: { id: source.id }, select: { total: true, refundedAmount: true } })
              .then((o) => o && { collected: o.total, refunded: o.refundedAmount ?? 0 });
      if (!totals) {
        throw new ApiError(source.kind === "payment" ? "Payment not found" : "Order not found", 404);
      }
      const inFlight = await tx.refund.aggregate({
        where:
          source.kind === "payment"
            ? { paymentId: source.id, status: "PENDING" }
            : { orderId: source.id, status: "PENDING" },
        _sum: { amount: true },
      });
      const pending = inFlight._sum.amount ?? 0;

      if (toPesewas(totals.collected - totals.refunded) <= 0) {
        throw new ApiError(`This ${source.kind} has already been fully refunded`, 400);
      }
      const refundable = round2(totals.collected - totals.refunded - pending);
      if (refundable <= 0) {
        throw new ApiError(
          `A refund for the rest of this ${source.kind} is already in progress`,
          400,
        );
      }

      const amount = requested ?? refundable;
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new ApiError("Refund amount must be greater than 0", 400);
      }
      if (toPesewas(amount) > toPesewas(refundable)) {
        throw new ApiError(
          `Refund exceeds what's left on this ${source.kind} (${ghs(refundable)} refundable)`,
          400,
        );
      }
      return { amount, refundable, refund: await create(tx, amount) };
    });
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

    // The webhook and the immediate path above can settle the same refund at
    // once. Claiming PENDING → outcome with a conditional update lets exactly
    // one of them through; the running total moves in the same locked step,
    // so reserveRefund never sees the refund in neither "pending" nor
    // "refunded".
    const apply = async (db: Pick<TenantTx, "refund" | "payment" | "order">) => {
      const claimed = await db.refund.updateMany({
        where: { id: refund.id, status: "PENDING" },
        data: {
          status: outcome,
          ...(outcome === "PROCESSED" ? { processedAt: new Date() } : {}),
          ...(failureReason ? { failureReason } : {}),
        },
      });
      if (claimed.count === 0) return false;
      if (outcome !== "PROCESSED") return true;

      // Roll the running total forward and move the source row's status.
      if (refund.paymentId) {
        const payment = await db.payment.findFirst({
          where: { id: refund.paymentId },
          select: { id: true, amount: true, refundedAmount: true },
        });
        if (payment) {
          const total = round2((payment.refundedAmount ?? 0) + refund.amount);
          await db.payment.update({
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
        const order = await db.order.findFirst({
          where: { id: refund.orderId },
          select: { id: true, refundedAmount: true },
        });
        if (order) {
          await db.order.update({
            where: { id: order.id },
            data: { refundedAmount: round2((order.refundedAmount ?? 0) + refund.amount) },
          });
        }
      }
      return true;
    };
    const source: RefundSource | null = refund.paymentId
      ? { kind: "payment", id: refund.paymentId }
      : refund.orderId
        ? { kind: "order", id: refund.orderId }
        : null;
    const applied = source
      ? await this.withAdvisoryLock(sourceLockKey(source), apply)
      : await apply(this.db);
    if (!applied) return this.refund.findUnique({ where: { id: refund.id } });

    const updated = await this.refund.findUniqueOrThrow({ where: { id: refund.id } });

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
      const brand = await this.studioEmailBrand(refund.studioId, platformBrand);
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
      const brand = await this.studioEmailBrand(refund.studioId, platformBrand);
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
