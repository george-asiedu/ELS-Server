import { createTenantClient } from "../tenant/tenantClient";
import { PAID_ORDER_STATUSES } from "../order/orderStatus";
import { saleDays } from "../sales/salesService";

// The second layer of insights: who comes back, when and who the business is
// busy, whether promotions worked, and how the month is going against a goal.
// Each part stays empty when there isn't enough history to say anything.

const { db } = createTenantClient();
const DAY = 86_400_000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const go = <T>(q: PromiseLike<T>): Promise<T> => Promise.resolve(q);
const digits = (s: string | null | undefined) =>
  (s ?? "").replace(/\D/g, "").slice(-9);

/** "9:00 AM", "14:30" and "09:00" all mean an hour of the day. */
export const hourOf = (time: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/i.exec(time.trim());
  if (!m) return null;
  let h = Number(m[1]);
  if (m[3]) h = (h % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0);
  return h >= 0 && h < 24 ? h : null;
};

export const computeExtras = async (studioId: string, days: number) => {
  const now = new Date();
  const from = new Date(now.getTime() - days * DAY);
  const yearAgo = new Date(now.getTime() - 365 * DAY);
  const since90 = new Date(now.getTime() - 90 * DAY);
  const today = new Date(now.toISOString().slice(0, 10) + "T00:00:00.000Z");
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const monthEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );

  const qAppts = go(
    db.appointment.findMany({
      where: {
        status: "COMPLETED",
        appointmentDate: { gte: yearAgo, lte: now },
      },
      select: {
        userId: true,
        phone: true,
        fullName: true,
        appointmentDate: true,
        totalPrice: true,
        discountAmount: true,
      },
      take: 8000,
    }),
  );
  const qOrders = go(
    db.order.findMany({
      where: {
        paidAt: { gte: yearAgo, lte: now },
        status: { in: [...PAID_ORDER_STATUSES] },
      },
      select: {
        userId: true,
        customerPhone: true,
        customerEmail: true,
        customerName: true,
        paidAt: true,
        total: true,
        couponCode: true,
        couponDiscount: true,
      },
      take: 8000,
    }),
  );
  const qBooked = go(
    db.appointment.findMany({
      where: {
        status: { in: ["CONFIRMED", "COMPLETED"] },
        appointmentDate: { gte: since90, lte: now },
      },
      select: {
        appointmentDate: true,
        appointmentTime: true,
        staffId: true,
        totalPrice: true,
        discountAmount: true,
        status: true,
      },
      take: 8000,
    }),
  );
  const qStaff = go(db.staff.findMany({ select: { id: true, name: true } }));
  const qSales = go(
    db.salePromo.findMany({ orderBy: { startsOn: "desc" }, take: 6 }),
  );
  const qGift = go(
    db.voucher.aggregate({
      where: { kind: "GIFT_CARD", status: "ACTIVE" },
      _sum: { balance: true },
      _count: { _all: true },
    }),
  );
  const qSettings = go(
    db.studioSettings.findUnique({
      where: { studioId },
      select: { revenueGoal: true },
    }),
  );
  const qMonthBookings = go(
    db.appointment.findMany({
      where: {
        status: { in: ["PENDING", "CONFIRMED"] },
        appointmentDate: { gt: now, lt: monthEnd },
      },
      select: { totalPrice: true, discountAmount: true },
    }),
  );
  const qMonthPaid = go(
    db.payment.findMany({
      where: {
        paidAt: { gte: monthStart, lte: now },
        status: { in: ["PAID", "PARTIALLY_REFUNDED"] },
      },
      select: { amount: true, refundedAmount: true },
    }),
  );
  const qMonthOrders = go(
    db.order.findMany({
      where: {
        paidAt: { gte: monthStart, lte: now },
        status: { in: [...PAID_ORDER_STATUSES] },
      },
      select: { total: true, refundedAmount: true },
    }),
  );
  const qMonthBills = go(
    db.bill.aggregate({
      where: { status: "PAID", paidAt: { gte: monthStart, lte: now } },
      _sum: { total: true },
    }),
  );
  for (const q of [
    qAppts,
    qOrders,
    qBooked,
    qStaff,
    qSales,
    qGift,
    qSettings,
    qMonthBookings,
    qMonthPaid,
    qMonthOrders,
    qMonthBills,
  ])
    q.catch(() => undefined);

  const [appts, orders] = await Promise.all([qAppts, qOrders]);

  // ------------------------------------------------------------ customers
  type Person = { name: string; visits: number[]; spend: number };
  const people = new Map<string, Person>();
  const touch = (key: string, name: string, at: Date, amount: number) => {
    const p = people.get(key) ?? { name, visits: [], spend: 0 };
    p.name = name || p.name;
    p.visits.push(at.getTime());
    p.spend += amount;
    people.set(key, p);
  };
  for (const a of appts)
    touch(
      a.userId ?? `p:${digits(a.phone)}`,
      a.fullName,
      a.appointmentDate,
      (a.totalPrice ?? 0) - (a.discountAmount ?? 0),
    );
  for (const o of orders)
    touch(
      o.userId ??
        (digits(o.customerPhone)
          ? `p:${digits(o.customerPhone)}`
          : `e:${(o.customerEmail ?? "").toLowerCase()}`),
      o.customerName ?? "",
      o.paidAt!,
      o.total,
    );
  const everyone = [...people.values()].filter((p) => p.visits.length);
  let customers: null | {
    total: number;
    newInPeriod: number;
    returningInPeriod: number;
    repeatRate: number | null;
    retained90: number | null;
    retainedCohort: number;
    top: { name: string; visits: number; spend: number }[];
  } = null;
  if (everyone.length >= 8) {
    let newIn = 0,
      retIn = 0;
    for (const p of everyone) {
      const first = Math.min(...p.visits);
      const inWindow = p.visits.some((v) => v >= from.getTime());
      if (!inWindow) continue;
      if (first >= from.getTime()) newIn++;
      else retIn++;
    }
    const repeat = everyone.filter((p) => p.visits.length >= 2).length;
    // Of the people who first came 3 to 6 months ago, how many came again within 90 days.
    const cohort = everyone.filter((p) => {
      const f = Math.min(...p.visits);
      return f >= now.getTime() - 180 * DAY && f < now.getTime() - 90 * DAY;
    });
    const back = cohort.filter((p) => {
      const f = Math.min(...p.visits);
      return p.visits.some((v) => v > f && v <= f + 90 * DAY);
    }).length;
    customers = {
      total: everyone.length,
      newInPeriod: newIn,
      returningInPeriod: retIn,
      repeatRate: Math.round((repeat / everyone.length) * 100),
      retained90:
        cohort.length >= 8 ? Math.round((back / cohort.length) * 100) : null,
      retainedCohort: cohort.length,
      top: [...everyone]
        .sort((a, b) => b.spend - a.spend)
        .slice(0, 5)
        .map((p) => ({
          name: p.name || "Customer",
          visits: p.visits.length,
          spend: r2(p.spend),
        })),
    };
  }

  // ------------------------------------------------------------ busy hours and staff
  const booked = await qBooked;
  let capacity: null | {
    hours: number[];
    grid: number[][];
    busiest: { day: string; hour: number; count: number }[];
    quietDay: { day: string; share: number } | null;
    busiestDay: { day: string; share: number } | null;
    staff: { name: string; count: number; revenue: number; share: number }[];
  } = null;
  if (booked.length >= 20) {
    const grid: number[][] = Array.from({ length: 7 }, () =>
      new Array(24).fill(0),
    );
    const byDay = new Array(7).fill(0) as number[];
    for (const a of booked) {
      const h = hourOf(a.appointmentTime);
      if (h === null) continue;
      grid[a.appointmentDate.getUTCDay()]![h]! += 1;
      byDay[a.appointmentDate.getUTCDay()]! += 1;
    }
    const usedHours = [
      ...new Set(
        booked
          .map((a) => hourOf(a.appointmentTime))
          .filter((h): h is number => h !== null),
      ),
    ].sort((a, b) => a - b);
    const lo = Math.max(0, (usedHours[0] ?? 8) - 0),
      hi = Math.min(23, usedHours[usedHours.length - 1] ?? 18);
    const hours = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
    const cells = hours.flatMap((h) =>
      grid.map((row, d) => ({ day: WEEKDAYS[d]!, hour: h, count: row[h]! })),
    );
    const total = byDay.reduce((s, n) => s + n, 0);
    const dayShare = byDay.map((n, d) => ({
      day: WEEKDAYS[d]!,
      share: total ? Math.round((n / total) * 100) : 0,
      n,
    }));
    const active = dayShare.filter((d) => d.n > 0);
    const staff = await qStaff;
    const perStaff = new Map<string, { count: number; revenue: number }>();
    for (const a of booked) {
      if (!a.staffId || a.status !== "COMPLETED") continue;
      const e = perStaff.get(a.staffId) ?? { count: 0, revenue: 0 };
      e.count += 1;
      e.revenue += (a.totalPrice ?? 0) - (a.discountAmount ?? 0);
      perStaff.set(a.staffId, e);
    }
    const staffRows = [...perStaff.entries()].map(([id, e]) => ({
      name: staff.find((s) => s.id === id)?.name ?? "Former team member",
      count: e.count,
      revenue: r2(e.revenue),
    }));
    const staffTotal = staffRows.reduce((s, r) => s + r.count, 0);
    capacity = {
      hours,
      grid: grid.map((row) => hours.map((h) => row[h]!)),
      busiest: cells
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)
        .filter((c) => c.count > 0),
      busiestDay: active.length
        ? ((): { day: string; share: number } => {
            const b = [...active].sort((x, y) => y.n - x.n)[0]!;
            return { day: b.day, share: b.share };
          })()
        : null,
      quietDay:
        active.length >= 3
          ? ((): { day: string; share: number } => {
              const q = [...active].sort((x, y) => x.n - y.n)[0]!;
              return { day: q.day, share: q.share };
            })()
          : null,
      staff:
        staffRows.length >= 2
          ? staffRows
              .sort((a, b) => b.revenue - a.revenue)
              .map((r) => ({
                ...r,
                share: staffTotal
                  ? Math.round((r.count / staffTotal) * 100)
                  : 0,
              }))
          : [],
    };
  }

  // ------------------------------------------------------------ promotions
  const sales = await qSales;
  const paidByDay = new Map<string, number>();
  for (const o of orders) {
    const k = o.paidAt!.toISOString().slice(0, 10);
    paidByDay.set(k, (paidByDay.get(k) ?? 0) + o.total);
  }
  const promoResults = sales
    .map((s) => {
      const ds = saleDays(s as never).filter(
        (d) => d <= today.toISOString().slice(0, 10),
      );
      if (!ds.length) return null;
      const saleSet = new Set(saleDays(s as never));
      const on =
        ds.reduce((t, d) => t + (paidByDay.get(d) ?? 0), 0) / ds.length;
      // The same weekdays in the eight weeks before it began, outside any sale.
      const base: number[] = [];
      for (let w = 1; w <= 8; w++)
        for (const d of ds) {
          const past = new Date(
            new Date(d + "T00:00:00.000Z").getTime() - w * 7 * DAY,
          )
            .toISOString()
            .slice(0, 10);
          if (!saleSet.has(past) && new Date(past) >= yearAgo)
            base.push(paidByDay.get(past) ?? 0);
        }
      if (base.length < 8) return null;
      const usual = base.reduce((a, b) => a + b, 0) / base.length;
      return {
        name: s.name,
        percentOff: s.percentOff,
        days: ds.length,
        perSaleDay: r2(on),
        usualPerDay: r2(usual),
        uplift: usual > 0 ? Math.round(((on - usual) / usual) * 100) : null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const couponMap = new Map<
    string,
    { uses: number; discount: number; revenue: number }
  >();
  const avgOrder = orders.length
    ? orders.reduce((s, o) => s + o.total, 0) / orders.length
    : 0;
  for (const o of orders) {
    if (!o.couponCode || o.paidAt! < since90) continue;
    const c = couponMap.get(o.couponCode) ?? {
      uses: 0,
      discount: 0,
      revenue: 0,
    };
    c.uses += 1;
    c.discount += o.couponDiscount;
    c.revenue += o.total;
    couponMap.set(o.couponCode, c);
  }
  const coupons = [...couponMap.entries()]
    .map(([code, c]) => ({
      code,
      uses: c.uses,
      discount: r2(c.discount),
      revenue: r2(c.revenue),
      avgOrder: r2(c.revenue / c.uses),
    }))
    .sort((a, b) => b.uses - a.uses)
    .slice(0, 5);
  const gift = await qGift;
  const promos = {
    sales: promoResults,
    coupons,
    shopAvgOrder: r2(avgOrder),
    giftCards: {
      outstanding: r2(gift._sum.balance ?? 0),
      count: gift._count._all,
    },
  };

  // ------------------------------------------------------------ goal and pace
  const settings = await qSettings;
  const goalAmount = settings?.revenueGoal ?? null;
  const [monthPaid, monthOrders, monthBills, monthAhead] = await Promise.all([
    qMonthPaid,
    qMonthOrders,
    qMonthBills,
    qMonthBookings,
  ]);
  const mtd = r2(
    monthPaid.reduce((s, p) => s + p.amount - p.refundedAmount, 0) +
      monthOrders.reduce((s, o) => s + o.total - o.refundedAmount, 0) +
      (monthBills._sum.total ?? 0),
  );
  const totalDays = Math.round(
    (monthEnd.getTime() - monthStart.getTime()) / DAY,
  );
  const elapsed = Math.max(
    1,
    Math.ceil((now.getTime() - monthStart.getTime()) / DAY),
  );
  const remaining = Math.max(0, totalDays - elapsed);
  const bookedAhead = r2(
    monthAhead.reduce(
      (s, a) => s + (a.totalPrice ?? 0) - (a.discountAmount ?? 0),
      0,
    ),
  );
  const projected = elapsed >= 3 ? r2((mtd / elapsed) * totalDays) : null;
  const goal = {
    target: goalAmount,
    monthToDate: mtd,
    daysLeft: remaining,
    projected,
    bookedAhead,
    status:
      goalAmount && projected !== null
        ? projected >= goalAmount
          ? "ahead"
          : projected >= goalAmount * 0.85
            ? "close"
            : "behind"
        : null,
    neededPerDay:
      goalAmount && remaining > 0
        ? r2(Math.max(0, goalAmount - mtd) / remaining)
        : null,
  };

  return { customers, capacity, promos, goal };
};
