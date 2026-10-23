import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import { PaystackVerifyData } from "../payment/paystackClient";

export type LedgerType =
  | "BOOKING_PAYMENT"
  | "ORDER_PAYMENT"
  | "SUBSCRIPTION_PAYMENT"
  | "REFUND"
  | "ADJUSTMENT";
export type LedgerDirection = "CREDIT" | "DEBIT";
export type LedgerStatus =
  | "PENDING"
  | "SUCCESS"
  | "FAILED"
  | "ABANDONED"
  | "REVERSED";

export interface PostEntry {
  studioId?: string | null;
  type: LedgerType;
  direction?: LedgerDirection;
  status: LedgerStatus;
  amount: number;
  currency?: string;
  // Must be stable for a given real-world event: the same event posted twice
  // (replayed webhook, reconcile sweep, client verify) collapses to one row.
  dedupeKey: string;
  reference?: string | null;
  transactionId?: string | null;
  channel?: string | null;
  description: string;
  customerName?: string | null;
  customerEmail?: string | null;
  paymentAttemptId?: string | null;
  paymentId?: string | null;
  orderId?: string | null;
  appointmentId?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  occurredAt?: Date | null;
}

export interface AttemptInput {
  reference: string;
  expectedAmount: number;
  currency?: string;
  studioId?: string | null;
  paymentId?: string | null;
  orderId?: string | null;
  appointmentId?: string | null;
  customerEmail?: string | null;
  customerName?: string | null;
}

// Tolerance for float money comparison. Amounts are compared in pesewas
// (integers) so this only absorbs representation error, never a real shortfall.
const PESEWA_EPSILON = 0.5;

export class LedgerService extends Connection {
  // ---- Payment attempts -------------------------------------------------

  /**
   * Record a new Paystack attempt. One row per reference, written before we
   * hand the reference to Paystack, so the attempt exists even if the customer
   * abandons and the webhook arrives much later.
   */
  public async openAttempt(input: AttemptInput) {
    return this.paymentAttempt.create({
      data: {
        ...(input.studioId ? { studioId: input.studioId } : {}),
        reference: input.reference,
        expectedAmount: input.expectedAmount,
        currency: input.currency ?? "GHS",
        status: "PENDING",
        ...(input.paymentId ? { paymentId: input.paymentId } : {}),
        ...(input.orderId ? { orderId: input.orderId } : {}),
        ...(input.appointmentId ? { appointmentId: input.appointmentId } : {}),
        ...(input.customerEmail ? { customerEmail: input.customerEmail } : {}),
        ...(input.customerName ? { customerName: input.customerName } : {}),
      },
    });
  }

  public async findAttempt(reference: string) {
    return this.paymentAttempt.findUnique({ where: { reference } });
  }

  /**
   * Verify Paystack's own numbers against what we asked for, BEFORE anything is
   * marked paid. Paystack reports `amount` in pesewas; we compare integers.
   *
   * Without this a client that drives the inline popup with its own amount
   * could underpay and still settle as fully paid, because the old flow trusted
   * `status === "success"` alone.
   */
  public assertAmountMatches(
    expectedAmount: number,
    expectedCurrency: string,
    data: PaystackVerifyData,
  ): { ok: true } | { ok: false; reason: string } {
    const expectedPesewas = Math.round(expectedAmount * 100);
    const paidPesewas = Number(data.amount);

    if (!Number.isFinite(paidPesewas)) {
      return {
        ok: false,
        reason: "Paystack returned no amount for this transaction",
      };
    }
    if (Math.abs(paidPesewas - expectedPesewas) > PESEWA_EPSILON) {
      return {
        ok: false,
        reason: `Amount mismatch: expected ${expectedPesewas} pesewas, Paystack reported ${paidPesewas}`,
      };
    }
    const paidCurrency = (data.currency ?? "").toUpperCase();
    if (paidCurrency && paidCurrency !== expectedCurrency.toUpperCase()) {
      return {
        ok: false,
        reason: `Currency mismatch: expected ${expectedCurrency}, Paystack reported ${paidCurrency}`,
      };
    }
    return { ok: true };
  }

  public async settleAttempt(
    reference: string,
    data: PaystackVerifyData,
    outcome: { status: LedgerStatus; failureReason?: string | null },
  ) {
    const attempt = await this.paymentAttempt.findUnique({
      where: { reference },
    });
    if (!attempt) return null;
    // Terminal states are never rewritten — the first definitive outcome wins.
    if (attempt.status === "SUCCESS" || attempt.status === "REVERSED")
      return attempt;

    return this.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: outcome.status,
        paidAmount: Number.isFinite(Number(data.amount))
          ? Number(data.amount) / 100
          : null,
        transactionId: data.id ? String(data.id) : null,
        channel: data.channel ?? null,
        paidAt: data.paid_at ? new Date(data.paid_at) : null,
        failureReason: outcome.failureReason ?? null,
      },
    });
  }

  // ---- Ledger -----------------------------------------------------------

  /**
   * Append one entry. Idempotent on `dedupeKey`: a duplicate post is swallowed
   * and the existing row returned, so replayed webhooks cannot inflate totals.
   * Best-effort — a ledger write must never break the payment it describes.
   */
  public async post(entry: PostEntry) {
    try {
      return await this.ledgerEntry.create({
        data: {
          // Explicit: in a studio request the tenant extension overwrites this
          // with the ambient studio, but the webhook/cron runs as super-admin
          // where nothing is injected and the entry would be studio-less.
          ...(entry.studioId ? { studioId: entry.studioId } : {}),
          type: entry.type,
          direction: entry.direction ?? "CREDIT",
          status: entry.status,
          amount: Math.abs(entry.amount),
          currency: entry.currency ?? "GHS",
          dedupeKey: entry.dedupeKey,
          description: entry.description,
          ...(entry.reference ? { reference: entry.reference } : {}),
          ...(entry.transactionId
            ? { transactionId: entry.transactionId }
            : {}),
          ...(entry.channel ? { channel: entry.channel } : {}),
          ...(entry.customerName ? { customerName: entry.customerName } : {}),
          ...(entry.customerEmail
            ? { customerEmail: entry.customerEmail }
            : {}),
          ...(entry.paymentAttemptId
            ? { paymentAttemptId: entry.paymentAttemptId }
            : {}),
          ...(entry.paymentId ? { paymentId: entry.paymentId } : {}),
          ...(entry.orderId ? { orderId: entry.orderId } : {}),
          ...(entry.appointmentId
            ? { appointmentId: entry.appointmentId }
            : {}),
          ...(entry.actorEmail ? { actorEmail: entry.actorEmail } : {}),
          ...(entry.actorRole ? { actorRole: entry.actorRole } : {}),
          ...(entry.occurredAt ? { occurredAt: entry.occurredAt } : {}),
        },
      });
    } catch (error) {
      // P2002 = dedupeKey already posted. That is the expected path on a
      // webhook replay, not an error.
      if ((error as { code?: string }).code === "P2002") {
        return this.ledgerEntry.findUnique({
          where: { dedupeKey: entry.dedupeKey },
        });
      }
      console.error("Ledger post failed:", error);
      return null;
    }
  }

  /**
   * Paginated ledger for a studio. `studioId` is only honoured in the
   * super-admin context — in a studio request the tenant extension overwrites
   * it with the caller's own studio, so a studio admin cannot read another's.
   */
  public async list(opts: {
    studioId?: string | undefined;
    type?: LedgerType | undefined;
    status?: LedgerStatus | undefined;
    direction?: LedgerDirection | undefined;
    from?: Date | undefined;
    to?: Date | undefined;
    // "customer" = paid by a customer; "studio" = the studio's own outgoings
    // (subscription renewals). Maps onto entry type.
    source?: "customer" | "studio" | undefined;
    search?: string | undefined;
    limit?: number | undefined;
    cursor?: string | undefined;
  }) {
    const take = Math.min(Math.max(opts.limit ?? 50, 1), 200);

    const where: Record<string, unknown> = {};
    if (opts.studioId) where.studioId = opts.studioId;
    if (opts.type) where.type = opts.type;
    if (opts.status) where.status = opts.status;
    if (opts.direction) where.direction = opts.direction;
    // An explicit `type` is more specific than `source`, so it wins when both
    // are given rather than being silently overwritten.
    if (!opts.type) {
      if (opts.source === "customer") {
        where.type = { in: ["BOOKING_PAYMENT", "ORDER_PAYMENT", "REFUND"] };
      } else if (opts.source === "studio") {
        where.type = { in: ["SUBSCRIPTION_PAYMENT", "ADJUSTMENT"] };
      }
    }
    if (opts.from || opts.to) {
      where.occurredAt = {
        ...(opts.from ? { gte: opts.from } : {}),
        ...(opts.to ? { lte: opts.to } : {}),
      };
    }
    if (opts.search) {
      const q = opts.search.trim();
      if (q) {
        where.OR = [
          { reference: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
          { customerName: { contains: q, mode: "insensitive" } },
          { customerEmail: { contains: q, mode: "insensitive" } },
        ];
      }
    }

    const rows = await this.ledgerEntry.findMany({
      where,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: take + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > take;
    const entries = hasMore ? rows.slice(0, take) : rows;

    return {
      entries,
      nextCursor: hasMore ? (entries[entries.length - 1]?.id ?? null) : null,
    };
  }

  /**
   * Totals for the ledger header. Only SUCCESS entries count toward money
   * received; pending and failed are reported separately so a studio admin can
   * see "received" and "didn't go through" without them being mixed.
   */
  public async summary(opts: {
    studioId?: string | undefined;
    from?: Date | undefined;
    to?: Date | undefined;
  }) {
    const base: Record<string, unknown> = {};
    if (opts.studioId) base.studioId = opts.studioId;
    if (opts.from || opts.to) {
      base.occurredAt = {
        ...(opts.from ? { gte: opts.from } : {}),
        ...(opts.to ? { lte: opts.to } : {}),
      };
    }

    const group = await this.ledgerEntry.groupBy({
      by: ["type", "direction", "status"],
      where: base,
      _sum: { amount: true },
      _count: { _all: true },
    });

    let received = 0;
    let refunded = 0;
    let paidOut = 0;
    let pending = 0;
    let failed = 0;
    let successCount = 0;

    for (const row of group) {
      const sum = row._sum.amount ?? 0;
      if (row.status === "SUCCESS") {
        successCount += row._count._all;
        if (row.type === "REFUND") refunded += sum;
        else if (row.direction === "DEBIT") paidOut += sum;
        else received += sum;
      } else if (row.status === "PENDING") {
        pending += sum;
      } else if (row.status === "FAILED" || row.status === "ABANDONED") {
        failed += sum;
      }
    }

    return {
      currency: "GHS",
      received,
      refunded,
      paidOut,
      // What the studio actually keeps from customer payments.
      net: received - refunded,
      pending,
      failed,
      transactions: successCount,
      byType: group.map((g) => ({
        type: g.type,
        direction: g.direction,
        status: g.status,
        amount: g._sum.amount ?? 0,
        count: g._count._all,
      })),
    };
  }

  /** Full detail for one entry, including sibling attempts on the reference. */
  public async detail(id: string) {
    const entry = await this.ledgerEntry.findUnique({ where: { id } });
    if (!entry) throw new ApiError("Ledger entry not found", 404);
    const attempts = entry.reference
      ? await this.paymentAttempt.findMany({
          where: { reference: entry.reference },
          orderBy: { createdAt: "asc" },
        })
      : [];
    return { entry, attempts };
  }
}
