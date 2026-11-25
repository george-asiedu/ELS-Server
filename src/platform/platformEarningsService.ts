import { PAID_ORDER_STATUSES } from "../order/orderStatus";
import { Connection } from "../db/dbConnection";
import { planName } from "../billing/billingPlans";

/**
 * What customers paid each studio and what the platform earned from it
 * (subscriptions, setup fees, commission), for the super admin's dashboard,
 * studio pages and the earnings ledger. Moved out of PlatformService
 * unchanged; PlatformService still exposes listEarnings and
 * platformEarningEntries, delegating here.
 */
export class PlatformEarningsService extends Connection {
  // Paid GMV per studio (booking payments + product orders), rounded to 2dp.
  /**
   * Money customers paid each studio (booking payments + paid product orders),
   * after refunds, optionally within [from, to] by payment date.
   */
  public async customerPaymentsByStudio(range?: { from: Date; to: Date }) {
    const paidAt = range ? { gte: range.from, lte: range.to } : undefined;
    const [payments, orders] = await Promise.all([
      this.payment.findMany({
        where: {
          status: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] },
          ...(paidAt ? { paidAt } : {}),
        },
        select: { studioId: true, amount: true, refundedAmount: true },
      }),
      this.order.findMany({
        where: {
          status: { in: [...PAID_ORDER_STATUSES] },
          ...(paidAt
            ? { OR: [{ paidAt }, { paidAt: null, createdAt: paidAt }] }
            : {}),
        },
        select: { studioId: true, total: true, refundedAmount: true },
      }),
    ]);
    const bookings = new Map<string, number>();
    const products = new Map<string, number>();
    for (const p of payments) {
      if (p.studioId)
        bookings.set(
          p.studioId,
          (bookings.get(p.studioId) ?? 0) + p.amount - (p.refundedAmount ?? 0),
        );
    }
    for (const o of orders) {
      if (o.studioId)
        products.set(
          o.studioId,
          (products.get(o.studioId) ?? 0) + o.total - (o.refundedAmount ?? 0),
        );
    }
    const total = new Map<string, number>();
    for (const [k, v] of [...bookings, ...products])
      total.set(k, (total.get(k) ?? 0) + v);
    return { total, bookings, products };
  }

  /**
   * What each studio paid the platform: its signup setup/activation fee,
   * applied renewals and plan changes, and (pay-as-you-earn studios) the
   * commission share of its customer payments. The commission is an estimate
   * from the studio's rate: Paystack splits it at payment time.
   */
  public async platformEarningsByStudio(
    studios: { id: string; billingMode: string; platformFeePercent: number }[],
    customerTotals: Map<string, number>,
    range?: { from: Date; to: Date },
  ) {
    const within = range ? { gte: range.from, lte: range.to } : undefined;
    const [signups, charges] = await Promise.all([
      this.studioSignup.findMany({
        where: {
          status: "PROVISIONED",
          studioId: { not: null },
          amountCharged: { gt: 0 },
          ...(within ? { updatedAt: within } : {}),
        },
        select: { studioId: true, amountCharged: true },
      }),
      this.studioBillingCharge.findMany({
        where: { status: "APPLIED", ...(within ? { appliedAt: within } : {}) },
        select: { studioId: true, amount: true },
      }),
    ]);
    const setupFees = new Map<string, number>();
    const renewals = new Map<string, number>();
    const commissions = new Map<string, number>();
    for (const x of signups) {
      if (x.studioId)
        setupFees.set(
          x.studioId,
          (setupFees.get(x.studioId) ?? 0) + (x.amountCharged ?? 0),
        );
    }
    for (const c of charges)
      renewals.set(c.studioId, (renewals.get(c.studioId) ?? 0) + c.amount);
    for (const st of studios) {
      if (st.billingMode === "REVENUE_SHARE" && st.platformFeePercent > 0) {
        commissions.set(
          st.id,
          ((customerTotals.get(st.id) ?? 0) * st.platformFeePercent) / 100,
        );
      }
    }
    const total = new Map<string, number>();
    for (const [k, v] of [...setupFees, ...renewals, ...commissions])
      total.set(k, (total.get(k) ?? 0) + v);
    return { total, setupFees, renewals, commissions };
  }

  /**
   * Every payment the platform has earned, one row each, newest first: signup
   * setup/activation fees, applied renewals and plan changes, and (estimated)
   * commission per pay-as-you-earn studio per month. This is where "Your
   * earnings" comes from, row by row.
   */
  public async platformEarningEntries(
    opts: {
      studioId?: string | undefined;
      from?: Date | undefined;
      to?: Date | undefined;
    } = {},
  ) {
    const within =
      opts.from || opts.to
        ? {
            ...(opts.from ? { gte: opts.from } : {}),
            ...(opts.to ? { lte: opts.to } : {}),
          }
        : undefined;
    const studioFilter = opts.studioId ? { studioId: opts.studioId } : {};
    const [studios, signups, charges] = await Promise.all([
      this.studio.findMany({
        where: opts.studioId ? { id: opts.studioId } : {},
        select: {
          id: true,
          name: true,
          slug: true,
          billingMode: true,
          platformFeePercent: true,
        },
      }),
      this.studioSignup.findMany({
        where: {
          status: "PROVISIONED",
          studioId: opts.studioId ? opts.studioId : { not: null },
          amountCharged: { gt: 0 },
          ...(within ? { updatedAt: within } : {}),
        },
        select: {
          id: true,
          studioId: true,
          reference: true,
          plan: true,
          cadence: true,
          billingMode: true,
          amountCharged: true,
          coverageMonths: true,
          updatedAt: true,
        },
      }),
      this.studioBillingCharge.findMany({
        where: {
          status: "APPLIED",
          ...studioFilter,
          ...(within ? { appliedAt: within } : {}),
        },
        select: {
          id: true,
          studioId: true,
          reference: true,
          kind: true,
          plan: true,
          cadence: true,
          amount: true,
          appliedAt: true,
          createdAt: true,
        },
      }),
    ]);
    const studioBy = new Map(studios.map((st) => [st.id, st]));
    const planLabel = (plan: string, cadence: string) =>
      `${planName(plan)} ${cadence === "YEARLY" ? "yearly" : "monthly"}`;

    type Entry = {
      id: string;
      date: Date;
      studio: { id: string; name: string; slug: string } | null;
      purpose:
        | "SETUP_FEE"
        | "ACTIVATION_FEE"
        | "RENEWAL"
        | "PLAN_CHANGE"
        | "COMMISSION";
      description: string;
      amount: number;
      reference: string | null;
      plan: string | null;
      cadence: string | null;
      estimated: boolean;
      detail: Record<string, string | number | null>;
    };
    const entries: Entry[] = [];
    const studioRef = (id: string | null) => {
      const st = id ? studioBy.get(id) : undefined;
      return st ? { id: st.id, name: st.name, slug: st.slug } : null;
    };

    for (const x of signups) {
      const sub = x.billingMode === "SUBSCRIPTION";
      entries.push({
        id: `signup:${x.id}`,
        date: x.updatedAt,
        studio: studioRef(x.studioId),
        purpose: sub ? "SETUP_FEE" : "ACTIVATION_FEE",
        description: sub
          ? `Setup fee at signup · ${planLabel(x.plan, x.cadence)}${x.coverageMonths ? ` · covers ${x.coverageMonths} months` : ""}`
          : `Activation fee at signup · ${planName(x.plan)} pay as you earn`,
        amount: x.amountCharged ?? 0,
        reference: x.reference,
        plan: x.plan,
        cadence: sub ? x.cadence : null,
        estimated: false,
        detail: { coverageMonths: x.coverageMonths ?? null },
      });
    }
    for (const c of charges) {
      entries.push({
        id: `charge:${c.id}`,
        date: c.appliedAt ?? c.createdAt,
        studio: studioRef(c.studioId),
        purpose: c.kind === "RENEWAL" ? "RENEWAL" : "PLAN_CHANGE",
        description:
          c.kind === "RENEWAL"
            ? `Renewal · ${planLabel(c.plan, c.cadence)}`
            : `Plan change to ${planLabel(c.plan, c.cadence)}`,
        amount: c.amount,
        reference: c.reference,
        plan: c.plan,
        cadence: c.cadence,
        estimated: false,
        detail: {},
      });
    }

    // Commission: Paystack splits it at payment time, so it's estimated from
    // each pay-as-you-earn studio's rate and its customer payments, per month.
    const shared = studios.filter(
      (st) => st.billingMode === "REVENUE_SHARE" && st.platformFeePercent > 0,
    );
    if (shared.length) {
      const ids = shared.map((st) => st.id);
      const paidAt = within;
      const [payments, orders] = await Promise.all([
        this.payment.findMany({
          where: {
            studioId: { in: ids },
            status: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] },
            paidAt: paidAt ?? { not: null },
          },
          select: {
            studioId: true,
            amount: true,
            refundedAmount: true,
            paidAt: true,
          },
        }),
        this.order.findMany({
          where: {
            studioId: { in: ids },
            status: { in: [...PAID_ORDER_STATUSES] },
            ...(paidAt
              ? { OR: [{ paidAt }, { paidAt: null, createdAt: paidAt }] }
              : {}),
          },
          select: {
            studioId: true,
            total: true,
            refundedAmount: true,
            paidAt: true,
            createdAt: true,
          },
        }),
      ]);
      const buckets = new Map<
        string,
        { studioId: string; month: Date; sales: number }
      >();
      const add = (studioId: string | null, when: Date | null, v: number) => {
        if (!studioId || !when) return;
        const month = new Date(when.getFullYear(), when.getMonth(), 1);
        const key = `${studioId}:${month.toISOString()}`;
        const b = buckets.get(key) ?? { studioId, month, sales: 0 };
        b.sales += v;
        buckets.set(key, b);
      };
      for (const p of payments)
        add(p.studioId, p.paidAt, p.amount - (p.refundedAmount ?? 0));
      for (const o of orders)
        add(
          o.studioId,
          o.paidAt ?? o.createdAt,
          o.total - (o.refundedAmount ?? 0),
        );
      for (const b of buckets.values()) {
        const st = studioBy.get(b.studioId)!;
        const amount =
          Math.round(((b.sales * st.platformFeePercent) / 100) * 100) / 100;
        if (amount <= 0) continue;
        const monthLabel = b.month.toLocaleDateString("en-GB", {
          month: "long",
          year: "numeric",
        });
        const lastDay = new Date(
          b.month.getFullYear(),
          b.month.getMonth() + 1,
          0,
          23,
          59,
          59,
        );
        entries.push({
          id: `commission:${b.studioId}:${b.month.toISOString().slice(0, 7)}`,
          date: lastDay > new Date() ? new Date() : lastDay,
          studio: studioRef(b.studioId),
          purpose: "COMMISSION",
          description: `Commission ${st.platformFeePercent}% on customer payments · ${monthLabel}`,
          amount,
          reference: null,
          plan: null,
          cadence: null,
          estimated: true,
          detail: {
            month: monthLabel,
            customerPayments: Math.round(b.sales * 100) / 100,
            ratePercent: st.platformFeePercent,
          },
        });
      }
    }

    entries.sort((a, b) => b.date.getTime() - a.date.getTime());
    return entries;
  }

  /** The earnings rows, paged, with totals by purpose and by studio. */
  public async listEarnings(q: {
    studioId?: string | undefined;
    purpose?: string | undefined;
    from?: Date | undefined;
    to?: Date | undefined;
    page?: number | undefined;
    pageSize?: number | undefined;
  }) {
    const all = await this.platformEarningEntries({
      studioId: q.studioId,
      from: q.from,
      to: q.to,
    });
    const rows = q.purpose ? all.filter((e) => e.purpose === q.purpose) : all;
    const pageSize = Math.min(Math.max(Number(q.pageSize) || 20, 1), 100);
    const page = Math.max(Number(q.page) || 1, 1);
    const r2 = (n: number) => Math.round(n * 100) / 100;

    const byPurpose: Record<string, number> = {};
    const byStudio = new Map<
      string,
      { studio: Entry["studio"]; amount: number; payments: number }
    >();
    type Entry = (typeof rows)[number];
    for (const e of rows) {
      byPurpose[e.purpose] = r2((byPurpose[e.purpose] ?? 0) + e.amount);
      const key = e.studio?.id ?? "unknown";
      const cur = byStudio.get(key) ?? {
        studio: e.studio,
        amount: 0,
        payments: 0,
      };
      cur.amount = r2(cur.amount + e.amount);
      cur.payments += 1;
      byStudio.set(key, cur);
    }
    return {
      message: "Earnings",
      data: rows.slice((page - 1) * pageSize, page * pageSize),
      summary: {
        total: r2(rows.reduce((t, e) => t + e.amount, 0)),
        byPurpose,
        byStudio: [...byStudio.values()].sort((a, b) => b.amount - a.amount),
      },
      pagination: {
        page,
        pageSize,
        total: rows.length,
        pages: Math.max(1, Math.ceil(rows.length / pageSize)),
      },
    };
  }
}
