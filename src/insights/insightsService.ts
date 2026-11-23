import { createTenantClient } from "../tenant/tenantClient";
import { MonthlyReportService } from "../reports/monthlyReport";
import { parseDurationMinutes } from "../appointment/duration";
import { PAID_ORDER_STATUSES } from "../order/orderStatus";
import { computeExtras } from "./deepInsights";

// Business insights: what happened, and what to do about it.
//
// The headline is a ranked list of findings, each one a plain-words statement
// with the people or items behind it, the money at stake, and where to act.
// Every rule has a minimum amount of history and says nothing when there isn't
// enough, rather than inventing a trend. The numbers use the same definition of
// income as the monthly report and the Expenses page, so they never disagree.

const { db } = createTenantClient();
const DAY = 86_400_000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const first = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] || "there";
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface Finding {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  /** What it's worth in GHS, with how to read it ("a month", "per 2 weeks", "tied up"). */
  impact: { amount: number; per: string } | null;
  items: { label: string; sub?: string; phone?: string; firstName?: string; href?: string }[];
  action: { label: string; href: string };
}

type Cache = { at: number; data: unknown };
const cache = new Map<string, Cache>();

const sumBills = async (from: Date, to: Date) =>
  r2((await db.bill.aggregate({ where: { status: "PAID", paidAt: { gte: from, lt: to } }, _sum: { total: true } }))._sum.total ?? 0);
const sumExpenses = async (from: Date, to: Date) =>
  r2((await db.expense.aggregate({ where: { date: { gte: from, lt: to } }, _sum: { amount: true } }))._sum.amount ?? 0);

/** Income in a period: booking payments, shop sales and paid bills, after refunds. */
const income = async (studioId: string, from: Date, to: Date) => {
  const f = await new MonthlyReportService().figures(studioId, from, to);
  const bills = await sumBills(from, to);
  return { revenue: r2(f.bookingRevenue + f.shopRevenue + bills), bookings: f.bookings, orders: f.orders, newCustomers: f.newCustomers, bills };
};

/** Prisma queries only start when awaited: this starts one now, so they all run together. */
const go = <T>(q: PromiseLike<T>): Promise<T> => Promise.resolve(q);

const pct = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);

export const computeInsights = async (studioId: string, days: number) => {
  const now = new Date();
  const to = now;
  const from = new Date(now.getTime() - days * DAY);
  const prevFrom = new Date(from.getTime() - days * DAY);
  const today = new Date(now.toISOString().slice(0, 10) + "T00:00:00.000Z");

  const [cur, prev, spent, prevSpent] = await Promise.all([
    income(studioId, from, to),
    income(studioId, prevFrom, from),
    sumExpenses(from, to),
    sumExpenses(prevFrom, from),
  ]);

  const findings: Finding[] = [];

  // Every independent question is asked at once, then read where it's used, so
  // the page waits for the slowest one instead of all of them in a row.
  const yearAgo = new Date(now.getTime() - 365 * DAY);
  const eightWeeks = new Date(now.getTime() - 56 * DAY);
  const since90 = new Date(now.getTime() - 90 * DAY);
  const paidOrders = { paidAt: { gte: new Date(now.getTime() - 60 * DAY) }, status: { in: [...PAID_ORDER_STATUSES] } };
  const qDone = go(db.appointment.findMany({
    where: { status: "COMPLETED", appointmentDate: { gte: yearAgo, lte: now } },
    select: { userId: true, phone: true, fullName: true, appointmentDate: true, totalPrice: true, discountAmount: true },
    orderBy: { appointmentDate: "asc" },
    take: 5000,
  }));
  const qPast = go(db.appointment.findMany({ where: { status: { in: ["CONFIRMED", "COMPLETED"] }, appointmentDate: { gte: eightWeeks, lt: today } }, select: { appointmentDate: true, totalPrice: true }, take: 5000 }));
  const qAhead = go(db.appointment.findMany({ where: { status: { in: ["PENDING", "CONFIRMED", "PENDING_RESCHEDULE"] }, appointmentDate: { gte: new Date(today.getTime() + DAY), lte: new Date(today.getTime() + 7 * DAY) } }, select: { appointmentDate: true } }));
  const qNoShows = go(db.appointment.findMany({
    where: { status: "NO_SHOW", appointmentDate: { gte: since90, lte: now } },
    select: { userId: true, phone: true, fullName: true, appointmentDate: true, totalPrice: true, discountAmount: true },
  }));
  const qCompleted = go(db.appointment.count({ where: { status: "COMPLETED", appointmentDate: { gte: from, lte: now } } }));
  const qProducts = go(db.product.findMany({ where: { active: true, trackStock: true }, select: { id: true, name: true, stock: true, price: true, costPrice: true, createdAt: true } }));
  const qSold28 = go(db.orderItem.groupBy({ by: ["productId"], where: { order: { paidAt: { gte: new Date(now.getTime() - 28 * DAY) }, status: { in: [...PAID_ORDER_STATUSES] } } }, _sum: { quantity: true } }));
  const qSold60 = go(db.orderItem.groupBy({ by: ["productId"], where: { order: paidOrders }, _sum: { quantity: true } }));
  const qOpen = go(db.order.findMany({ where: { status: { in: ["PAID", "PREPARING", "READY_FOR_PICKUP", "OUT_FOR_DELIVERY"] } }, select: { orderNumber: true, customerName: true, status: true, paidAt: true, statusUpdatedAt: true, fulfillment: true } }));
  const qDelivered = go(db.order.findMany({ where: { deliveredAt: { gte: from, lte: now }, paidAt: { not: null }, fulfillment: "DELIVERY" }, select: { paidAt: true, deliveredAt: true, deliveryZone: true } }));
  const qUnpaid = go(db.bill.findMany({ where: { status: "UNPAID" }, select: { number: true, customerName: true, customerPhone: true, total: true, createdAt: true }, orderBy: { createdAt: "asc" }, take: 100 }));
  const qSvcRows = go(db.appointment.groupBy({ by: ["serviceId"], where: { status: "COMPLETED", appointmentDate: { gte: since90, lte: now } }, _count: { _all: true }, _sum: { totalPrice: true, discountAmount: true } }));
  const qServices = go(db.service.findMany({ select: { id: true, name: true, duration: true } }));
  const qItems = go(db.orderItem.findMany({ where: { order: { paidAt: { gte: since90 }, status: { in: [...PAID_ORDER_STATUSES] } } }, select: { name: true, unitPrice: true, costPrice: true, quantity: true }, take: 5000 }));
  // Some of these are only read when an earlier rule fires; a failure in one that is never read must not crash the process.
  for (const q of [qDone, qPast, qAhead, qNoShows, qCompleted, qProducts, qSold28, qSold60, qOpen, qDelivered, qUnpaid, qSvcRows, qServices, qItems]) q.catch(() => undefined);

  // ---------------------------------------------------------------- regulars gone quiet
  // People who've come at least three times, whose gap since the last visit is
  // well past how often they usually come.
  const done = await qDone;
  const byPerson = new Map<string, { name: string; phone: string; dates: number[]; spend: number }>();
  for (const a of done) {
    const key = a.userId ?? `p:${a.phone.replace(/\D/g, "").slice(-9)}`;
    const p = byPerson.get(key) ?? { name: a.fullName, phone: a.phone, dates: [], spend: 0 };
    p.name = a.fullName;
    p.phone = a.phone;
    p.dates.push(a.appointmentDate.getTime());
    p.spend += (a.totalPrice ?? 0) - (a.discountAmount ?? 0);
    byPerson.set(key, p);
  }
  const quiet = [...byPerson.values()]
    .filter((p) => p.dates.length >= 3)
    .map((p) => {
      const gap = (p.dates[p.dates.length - 1]! - p.dates[0]!) / (p.dates.length - 1) / DAY;
      const since = (today.getTime() - p.dates[p.dates.length - 1]!) / DAY;
      return { ...p, gap, since, monthly: gap > 0 ? (p.spend / p.dates.length) * (30 / gap) : 0 };
    })
    .filter((p) => p.gap >= 5 && p.since > p.gap * 1.5 && p.since < 270)
    .sort((a, b) => b.monthly - a.monthly);
  if (quiet.length) {
    findings.push({
      id: "quiet-regulars",
      severity: quiet.length >= 5 ? "high" : "medium",
      title: `${quiet.length} regular ${quiet.length === 1 ? "customer has" : "customers have"} gone quiet`,
      detail: "They used to come often and haven't been back for much longer than their usual gap. A friendly message now is the cheapest way to win them back.",
      impact: { amount: Math.round(quiet.reduce((s, p) => s + p.monthly, 0)), per: "a month" },
      items: quiet.slice(0, 8).map((p) => ({
        label: p.name,
        sub: `Usually every ${Math.round(p.gap)} days, last here ${Math.round(p.since)} days ago`,
        phone: p.phone,
        firstName: first(p.name),
      })),
      action: { label: "Open customers", href: "/admin/users" },
    });
  }

  // ---------------------------------------------------------------- slow days ahead
  // Next week's bookings against what each weekday usually gets.
  const [past, ahead] = await Promise.all([qPast, qAhead]);
  if (past.length >= 12) {
    const perDay = new Array(7).fill(0) as number[];
    for (const a of past) perDay[a.appointmentDate.getUTCDay()]! += 1;
    const usual = perDay.map((n) => n / 8);
    const ticket = past.reduce((s, a) => s + (a.totalPrice ?? 0), 0) / past.length;
    const slow: { date: Date; booked: number; usual: number }[] = [];
    for (let i = 1; i <= 7; i++) {
      const d = new Date(today.getTime() + i * DAY);
      const booked = ahead.filter((a) => a.appointmentDate.getTime() === d.getTime()).length;
      const u = usual[d.getUTCDay()]!;
      if (u >= 2 && booked < u * 0.5) slow.push({ date: d, booked, usual: u });
    }
    if (slow.length) {
      findings.push({
        id: "slow-days",
        severity: "medium",
        title: `${slow.length === 1 ? "A day" : `${slow.length} days`} next week ${slow.length === 1 ? "looks" : "look"} quiet`,
        detail: "Bookings so far are well below what these days usually get. A short promotion or a message to past customers can fill them.",
        impact: { amount: Math.round(slow.reduce((s, d) => s + (d.usual - d.booked) * ticket, 0)), per: "if they fill up" },
        items: slow.map((d) => ({ label: `${WEEKDAYS[d.date.getUTCDay()]} ${d.date.getUTCDate()}`, sub: `${d.booked} booked, usually about ${Math.round(d.usual)}` })),
        action: { label: "Set up a promotion", href: "/admin/promos" },
      });
    }
  }

  // ---------------------------------------------------------------- no-shows
  const noShows = await qNoShows;
  const recentNoShows = noShows.filter((a) => a.appointmentDate >= from);
  if (recentNoShows.length >= 2) {
    const lost = recentNoShows.reduce((s, a) => s + (a.totalPrice ?? 0) - (a.discountAmount ?? 0), 0);
    const completed = await qCompleted;
    const rate = Math.round((recentNoShows.length / Math.max(1, recentNoShows.length + completed)) * 100);
    const repeat = new Map<string, { name: string; phone: string; n: number }>();
    for (const a of noShows) {
      const k = a.userId ?? `p:${a.phone.replace(/\D/g, "").slice(-9)}`;
      const e = repeat.get(k) ?? { name: a.fullName, phone: a.phone, n: 0 };
      e.n += 1;
      repeat.set(k, e);
    }
    const offenders = [...repeat.values()].filter((e) => e.n >= 2).sort((a, b) => b.n - a.n);
    findings.push({
      id: "no-shows",
      severity: rate >= 10 ? "high" : "medium",
      title: `${recentNoShows.length} no-shows in the last ${days} days (${rate}% of bookings)`,
      detail: offenders.length
        ? "A few people account for repeat misses. Customers with two no-shows are already asked to pay in full when they book; a deposit or reminder for the rest can cut the rest."
        : "Reminders and a small deposit are the two things that bring this down.",
      impact: { amount: Math.round(lost), per: "of bookings missed" },
      items: offenders.slice(0, 6).map((e) => ({ label: e.name, sub: `${e.n} no-shows in 90 days`, phone: e.phone, firstName: first(e.name) })),
      action: { label: "Payment settings", href: "/admin/payments" },
    });
  }

  // ---------------------------------------------------------------- stock
  const products = await qProducts;
  if (products.length) {
    const [sold28, sold60] = await Promise.all([qSold28, qSold60]);
    const rate = new Map(sold28.map((s) => [s.productId, (s._sum.quantity ?? 0) / 4]));
    const units60 = new Map(sold60.map((s) => [s.productId, s._sum.quantity ?? 0]));
    const running = products
      .map((p) => ({ p, weekly: rate.get(p.id) ?? 0 }))
      .filter(({ p, weekly }) => weekly >= 0.5 && p.stock / weekly < 2)
      .sort((a, b) => a.p.stock / a.weekly - b.p.stock / b.weekly);
    if (running.length) {
      findings.push({
        id: "stock-running-out",
        severity: running.some(({ p }) => p.stock <= 0) ? "high" : "medium",
        title: `${running.length} ${running.length === 1 ? "product is" : "products are"} about to run out`,
        detail: "These sell steadily and you have under two weeks of stock left (or none). Restock before customers find them gone.",
        impact: { amount: Math.round(running.reduce((s, { p, weekly }) => s + weekly * 2 * p.price, 0)), per: "in sales every 2 weeks" },
        items: running.slice(0, 6).map(({ p, weekly }) => ({
          label: p.name,
          sub: p.stock <= 0 ? `Sold out, selling about ${weekly.toFixed(1)} a week` : `${p.stock} left, selling about ${weekly.toFixed(1)} a week (${Math.max(1, Math.round((p.stock / weekly) * 7))} days)`,
        })),
        action: { label: "Open products", href: "/admin/products" },
      });
    }
    const dead = products.filter((p) => p.stock > 0 && p.createdAt < new Date(now.getTime() - 60 * DAY) && (units60.get(p.id) ?? 0) === 0);
    if (dead.length >= 2) {
      findings.push({
        id: "slow-stock",
        severity: "low",
        title: `${dead.length} products haven't sold in 60 days`,
        detail: "Money is sitting on the shelf. A sale or bundle can turn it back into cash.",
        impact: { amount: Math.round(dead.reduce((s, p) => s + p.stock * (p.costPrice > 0 ? p.costPrice : p.price), 0)), per: "tied up in stock" },
        items: dead.slice(0, 6).map((p) => ({ label: p.name, sub: `${p.stock} in stock` })),
        action: { label: "Schedule a sale", href: "/admin/sales" },
      });
    }
  }

  // ---------------------------------------------------------------- orders and deliveries
  const open = await qOpen;
  const limits: Record<string, number> = { PAID: 24, PREPARING: 24, OUT_FOR_DELIVERY: 36, READY_FOR_PICKUP: 72 };
  const stages: Record<string, string> = { PAID: "Paid, not started", PREPARING: "Preparing", OUT_FOR_DELIVERY: "Out for delivery", READY_FOR_PICKUP: "Ready to collect" };
  const stuck = open
    .map((o) => ({ o, hours: (now.getTime() - (o.statusUpdatedAt ?? o.paidAt ?? now).getTime()) / 3_600_000 }))
    .filter(({ o, hours }) => hours > (limits[o.status] ?? 24))
    .sort((a, b) => b.hours - a.hours);
  if (stuck.length) {
    const delivered = await qDelivered;
    const hoursOf = (o: { paidAt: Date | null; deliveredAt: Date | null }) => (o.deliveredAt!.getTime() - o.paidAt!.getTime()) / 3_600_000;
    const avg = delivered.length ? delivered.reduce((s, o) => s + hoursOf(o), 0) / delivered.length : null;
    findings.push({
      id: "overdue-orders",
      severity: stuck.length >= 3 ? "high" : "medium",
      title: `${stuck.length} ${stuck.length === 1 ? "order has" : "orders have"} been waiting too long`,
      detail: `Customers are waiting on these.${avg !== null ? ` Deliveries are averaging ${Math.round(avg)} hours from payment to the door.` : ""}`,
      impact: null,
      items: stuck.slice(0, 6).map(({ o, hours }) => ({ label: `${o.orderNumber}${o.customerName ? `, ${o.customerName}` : ""}`, sub: `${stages[o.status] ?? o.status} for ${hours >= 48 ? `${Math.round(hours / 24)} days` : `${Math.round(hours)} hours`}` })),
      action: { label: "Open orders", href: "/admin/orders" },
    });
  }

  // ---------------------------------------------------------------- money owed
  const unpaid = await qUnpaid;
  if (unpaid.length) {
    const total = unpaid.reduce((s, b) => s + b.total, 0);
    const oldest = Math.round((now.getTime() - unpaid[0]!.createdAt.getTime()) / DAY);
    findings.push({
      id: "unpaid-bills",
      severity: oldest >= 7 ? "high" : "medium",
      title: `${unpaid.length} unpaid ${unpaid.length === 1 ? "bill" : "bills"}`,
      detail: `The oldest is ${oldest} ${oldest === 1 ? "day" : "days"} old. Resend the payment link or ask them to pay now.`,
      impact: { amount: Math.round(total), per: "waiting to be paid" },
      items: unpaid.slice(0, 6).map((b) => ({ label: `${b.customerName}, ${b.number}`, sub: `GHS ${b.total.toFixed(2)}, ${Math.max(0, Math.round((now.getTime() - b.createdAt.getTime()) / DAY))} days`, ...(b.customerPhone ? { phone: b.customerPhone, firstName: first(b.customerName) } : {}) })),
      action: { label: "Open bills", href: "/admin/bills" },
    });
  }

  // ---------------------------------------------------------------- what earns the most
  const [svcRows, services, itemRows] = await Promise.all([qSvcRows, qServices, qItems]);
  const svcById = new Map(services.map((s) => [s.id, s]));
  const topServices = svcRows
    .map((r) => {
      const s = svcById.get(r.serviceId);
      const revenue = r2((r._sum.totalPrice ?? 0) - (r._sum.discountAmount ?? 0));
      const minutes = parseDurationMinutes(s?.duration);
      return { name: s?.name ?? "Removed service", count: r._count._all, revenue, perHour: minutes ? r2(revenue / ((minutes * r._count._all) / 60)) : null };
    })
    .filter((s) => s.count >= 2)
    .sort((a, b) => (b.perHour ?? -1) - (a.perHour ?? -1) || b.revenue - a.revenue)
    .slice(0, 5);
  const prod = new Map<string, { name: string; units: number; revenue: number; profit: number }>();
  for (const i of itemRows) {
    const e = prod.get(i.name) ?? { name: i.name, units: 0, revenue: 0, profit: 0 };
    e.units += i.quantity;
    e.revenue += i.unitPrice * i.quantity;
    e.profit += (i.unitPrice - i.costPrice) * i.quantity;
    prod.set(i.name, e);
  }
  const topProducts = [...prod.values()].map((p) => ({ ...p, revenue: r2(p.revenue), profit: r2(p.profit) })).sort((a, b) => b.profit - a.profit).slice(0, 5);

  const rank: Record<Finding["severity"], number> = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => rank[a.severity] - rank[b.severity] || (b.impact?.amount ?? 0) - (a.impact?.amount ?? 0));

  const activity = cur.bookings + cur.orders + prev.bookings + prev.orders;
  return {
    period: { days, from: from.toISOString(), to: to.toISOString() },
    money: {
      revenue: cur.revenue,
      revenueChange: pct(cur.revenue, prev.revenue),
      expenses: spent,
      expensesChange: pct(spent, prevSpent),
      profit: r2(cur.revenue - spent),
      profitPrevious: r2(prev.revenue - prevSpent),
      bookings: cur.bookings,
      orders: cur.orders,
      newCustomers: cur.newCustomers,
      owed: r2(unpaid.reduce((s, b) => s + b.total, 0)),
    },
    findings: findings.slice(0, 10),
    earners: { services: topServices, products: topProducts },
    thin: activity < 10,
  };
};

export type InsightsResult = Awaited<ReturnType<typeof computeInsights>> & Awaited<ReturnType<typeof computeExtras>>;

/** Cached for a few minutes: the sums touch a lot of rows and change slowly. */
export const insightsFor = async (studioId: string, days: number, refresh = false): Promise<InsightsResult> => {
  const key = `${studioId}:${days}`;
  const hit = cache.get(key);
  if (!refresh && hit && Date.now() - hit.at < 10 * 60_000) return hit.data as InsightsResult;
  const [base, extras] = await Promise.all([computeInsights(studioId, days), computeExtras(studioId, days)]);
  const data = { ...base, ...extras };
  cache.set(key, { at: Date.now(), data });
  return data;
};
