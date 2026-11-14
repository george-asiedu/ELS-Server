import { Connection } from "../db/dbConnection";
import { runAsSuperAdmin } from "../tenant/context";
import { NotificationService } from "../notifications/notificationService";
import { NotificationTemplate } from "../notifications/registry";
import { brandFromStudio, firstName, platformBrand } from "../notifications/brand";
import { monthlyReport, ReportFigure } from "../notifications/templates/report";
import { studioLink } from "../utils/studioLink";

// The monthly report: on the first days of a month, every admin of every
// active studio and store gets last month's figures by email, plus a push
// telling them it's there. The notification log keys each studio-month, so
// the daily sweep sends each report once and catches up if a day was missed.

const r2 = (n: number) => Math.round(n * 100) / 100;
// Whole amounts without pennies; otherwise always two places ("142.50").
const money = (n: number) => {
  const d = Number.isInteger(n) ? 0 : 2;
  return `GHS ${n.toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
};

/** "+12%", "−8%", "new" or null, comparing two amounts. */
const changeOf = (now: number, before: number): { change: string | null; up?: boolean } => {
  if (now === 0 && before === 0) return { change: null };
  if (before === 0) return { change: "New", up: true };
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return { change: "No change" };
  return { change: `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`, up: pct > 0 };
};

interface MonthFigures {
  bookings: number;
  cancelled: number;
  bookingRevenue: number;
  orders: number;
  shopRevenue: number;
  newCustomers: number;
}

export class MonthlyReportService extends Connection {
  private notifications = new NotificationService();

  private async figures(studioId: string, from: Date, to: Date): Promise<MonthFigures> {
    const [bookings, cancelled, payments, orders, newCustomers] = await Promise.all([
      this.appointment.count({
        where: { studioId, appointmentDate: { gte: from, lt: to }, status: { in: ["CONFIRMED", "COMPLETED"] } },
      }),
      this.appointment.count({
        where: { studioId, appointmentDate: { gte: from, lt: to }, status: "CANCELLED" },
      }),
      this.payment.findMany({
        where: { studioId, paidAt: { gte: from, lt: to }, status: { in: ["PAID", "PARTIALLY_REFUNDED"] } },
        select: { amount: true, refundedAmount: true },
      }),
      this.order.findMany({
        where: { studioId, paidAt: { gte: from, lt: to }, status: { in: ["PAID", "FULFILLED"] } },
        select: { total: true, refundedAmount: true },
      }),
      this.user.count({ where: { studioId, role: "CUSTOMER", createdAt: { gte: from, lt: to } } }),
    ]);
    return {
      bookings,
      cancelled,
      bookingRevenue: r2(payments.reduce((t, p) => t + p.amount - p.refundedAmount, 0)),
      orders: orders.length,
      shopRevenue: r2(orders.reduce((t, o) => t + o.total - o.refundedAmount, 0)),
      newCustomers,
    };
  }

  private async topService(studioId: string, from: Date, to: Date) {
    const rows = await this.appointment.groupBy({
      by: ["serviceId"],
      where: { studioId, appointmentDate: { gte: from, lt: to }, status: { in: ["CONFIRMED", "COMPLETED"] } },
      _count: { _all: true },
      orderBy: { _count: { serviceId: "desc" } },
      take: 1,
    });
    if (!rows[0]) return null;
    const service = await this.service.findUnique({ where: { id: rows[0].serviceId }, select: { name: true } });
    return service ? { name: service.name, count: rows[0]._count._all } : null;
  }

  private async topProduct(studioId: string, from: Date, to: Date) {
    const rows = await this.orderItem.groupBy({
      by: ["name"],
      where: { studioId, order: { paidAt: { gte: from, lt: to }, status: { in: ["PAID", "FULFILLED"] } } },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 1,
    });
    return rows[0] ? { name: rows[0].name, count: rows[0]._sum.quantity ?? 0 } : null;
  }

  /** Sends last month's report to each studio's admins (once per studio-month). */
  public async sendDue(now = new Date()) {
    // Only in the first week: late enough to catch up after downtime, early
    // enough that "last month" still reads as recent.
    if (now.getUTCDate() > 7) return { skipped: "Reports go out in the first week of the month" };
    return runAsSuperAdmin(async () => {
      // Last month, in UTC calendar months.
      const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const before = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
      const monthKey = from.toISOString().slice(0, 7);
      const monthLabel = from.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

      const studios = await this.studio.findMany({
        where: { status: "ACTIVE", createdAt: { lt: thisMonth } },
        select: { id: true, name: true, slug: true },
      });
      let sent = 0;
      const errors: string[] = [];

      for (const studio of studios) {
        try {
          const admins = await this.user.findMany({
            where: { studioId: studio.id, role: "ADMIN" },
            select: { email: true, profile: { select: { fullName: true } } },
          });
          if (!admins.length) continue;
          // Already sent this month's report: skip the work of building it again.
          const done = await this.notificationLog.count({
            where: { template: NotificationTemplate.STUDIO_MONTHLY_REPORT, entityId: `${studio.id}:${monthKey}` },
          });
          if (done >= admins.length) continue;
          const settings = await this.studioSettings.findUnique({
            where: { studioId: studio.id },
            select: { booking: true, commerce: true },
          });
          const booking = settings?.booking !== false;
          const shop = Boolean(settings?.commerce);

          const [cur, prev, service, product] = await Promise.all([
            this.figures(studio.id, from, thisMonth),
            this.figures(studio.id, before, from),
            booking ? this.topService(studio.id, from, thisMonth) : null,
            shop ? this.topProduct(studio.id, from, thisMonth) : null,
          ]);

          const figures: ReportFigure[] = [
            ...(booking
              ? [
                  { label: "Bookings", value: String(cur.bookings), ...changeOf(cur.bookings, prev.bookings) },
                  { label: "Booking payments", value: money(cur.bookingRevenue), ...changeOf(cur.bookingRevenue, prev.bookingRevenue) },
                ]
              : []),
            ...(shop
              ? [
                  { label: "Shop orders", value: String(cur.orders), ...changeOf(cur.orders, prev.orders) },
                  { label: "Shop sales", value: money(cur.shopRevenue), ...changeOf(cur.shopRevenue, prev.shopRevenue) },
                ]
              : []),
            { label: "New customers", value: String(cur.newCustomers), ...changeOf(cur.newCustomers, prev.newCustomers) },
            ...(booking
              ? [{ label: "Cancellations", value: String(cur.cancelled), ...changeOf(cur.cancelled, prev.cancelled), ...(cur.cancelled !== prev.cancelled ? { up: cur.cancelled < prev.cancelled } : {}) }]
              : []),
          ];

          const highlights = [
            ...(service ? [`Most booked: ${service.name} (${service.count} ${service.count === 1 ? "booking" : "bookings"})`] : []),
            ...(product ? [`Best seller: ${product.name} (${product.count} sold)`] : []),
          ];

          const branding = await this.currentStudioBranding(studio.id);
          const brand = brandFromStudio(branding, platformBrand);
          for (const admin of admins) {
            const { subject, html } = monthlyReport(brand, {
              adminFirstName: firstName(admin.profile?.fullName ?? "there"),
              studioName: studio.name,
              monthLabel,
              figures,
              highlights,
              analyticsUrl: studioLink(studio.slug, booking ? "/admin/analytics" : "/admin"),
            });
            await this.notifications.send({
              template: NotificationTemplate.STUDIO_MONTHLY_REPORT,
              to: admin.email,
              subject,
              html,
              studioId: studio.id,
              entityType: "Studio",
              entityId: `${studio.id}:${monthKey}`,
              pushBody: `Your ${monthLabel} report is in your email. Open it to see how ${studio.name} did.`,
            });
            sent++;
          }
        } catch (error) {
          errors.push(`${studio.id}: ${error instanceof Error ? error.message : "unknown"}`);
        }
      }
      return { month: monthKey, studios: studios.length, sent, errors };
    });
  }
}
