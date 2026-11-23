import { Request, Response, Router } from "express";
import { authenticate, requireAdmin } from "../middleware/auth";
import { ApiError } from "../middleware/apiError";
import { createTenantClient } from "../tenant/tenantClient";

// CSV downloads for a business's records (for an accountant, or a spreadsheet):
// bookings, orders, transactions and expenses, optionally between two dates.

const { db } = createTenantClient();
const router: Router = Router();
const MAX_ROWS = 20000;

const cell = (v: unknown) => {
  if (v === null || v === undefined) return "";
  const s =
    v instanceof Date
      ? v.toISOString().replace("T", " ").slice(0, 16)
      : String(v);
  // Quote anything with a comma, quote or line break; stop a spreadsheet from
  // treating a value as a formula.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const csv = (header: string[], rows: unknown[][]) =>
  [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";

const range = (req: Request) => {
  const day = (v: unknown, end: boolean) =>
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
      ? new Date(`${v}T${end ? "23:59:59.999" : "00:00:00.000"}Z`)
      : undefined;
  const from = day(req.query.from, false);
  const to = day(req.query.to, true);
  return from || to
    ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) }
    : undefined;
};

router.get(
  "/:kind",
  authenticate,
  requireAdmin,
  async (req: Request, res: Response) => {
    const when = range(req);
    let name: string;
    let body: string;
    switch (req.params.kind) {
      case "bookings": {
        const rows = await db.appointment.findMany({
          where: when ? { appointmentDate: when } : {},
          orderBy: [{ appointmentDate: "desc" }],
          take: MAX_ROWS,
          include: {
            service: { select: { name: true } },
            staff: { select: { name: true } },
            payment: true,
          },
        });
        name = "bookings";
        body = csv(
          [
            "Date",
            "Time",
            "Customer",
            "Phone",
            "Email",
            "Service",
            "With",
            "Status",
            "Price",
            "Discount",
            "To pay",
            "Paid online",
            "Payment status",
          ],
          rows.map((a) => [
            a.appointmentDate.toISOString().slice(0, 10),
            a.appointmentTime,
            a.fullName,
            a.phone,
            a.email,
            a.service?.name,
            a.staff?.name,
            a.status,
            a.totalPrice,
            a.discountAmount,
            (a.totalPrice ?? 0) - a.discountAmount,
            a.payment?.amount ?? 0,
            a.payment?.status ?? "",
          ]),
        );
        break;
      }
      case "orders": {
        const rows = await db.order.findMany({
          where: when ? { createdAt: when } : {},
          orderBy: { createdAt: "desc" },
          take: MAX_ROWS,
          include: { items: true },
        });
        name = "orders";
        body = csv(
          [
            "Order",
            "Date",
            "Customer",
            "Email",
            "Phone",
            "Items",
            "Subtotal",
            "Discount",
            "Delivery",
            "Total",
            "Status",
            "Fulfilment",
            "Paid at",
            "Reference",
          ],
          rows.map((o) => [
            o.orderNumber,
            o.createdAt,
            o.customerName,
            o.customerEmail,
            o.customerPhone,
            o.items.map((i) => `${i.name} x${i.quantity}`).join("; "),
            o.subtotal,
            o.discountAmount,
            o.deliveryFee,
            o.total,
            o.status,
            o.fulfillment,
            o.paidAt,
            o.reference,
          ]),
        );
        break;
      }
      case "transactions": {
        const rows = await db.ledgerEntry.findMany({
          where: when ? { createdAt: when } : {},
          orderBy: { createdAt: "desc" },
          take: MAX_ROWS,
        });
        name = "transactions";
        body = csv(
          [
            "Date",
            "Type",
            "Direction",
            "Status",
            "Amount",
            "Currency",
            "Description",
            "Customer",
            "Customer email",
            "Channel",
            "Reference",
          ],
          rows.map((t) => [
            t.occurredAt ?? t.createdAt,
            t.type,
            t.direction,
            t.status,
            t.amount,
            t.currency,
            t.description,
            t.customerName,
            t.customerEmail,
            t.channel,
            t.reference,
          ]),
        );
        break;
      }
      case "expenses": {
        const rows = await db.expense.findMany({
          where: when ? { date: when } : {},
          orderBy: { date: "desc" },
          take: MAX_ROWS,
        });
        name = "expenses";
        body = csv(
          ["Date", "Category", "Note", "Amount"],
          rows.map((e) => [
            e.date.toISOString().slice(0, 10),
            e.category,
            e.description,
            e.amount,
          ]),
        );
        break;
      }
      default:
        throw new ApiError(
          "Choose bookings, orders, transactions or expenses",
          400,
        );
    }
    const stamp = new Date().toISOString().slice(0, 10);
    res
      .set("Content-Disposition", `attachment; filename="${name}-${stamp}.csv"`)
      .set("Cache-Control", "no-store")
      .type("text/csv; charset=utf-8")
      // A byte-order mark so Excel reads accented names correctly.
      .send(`\uFEFF${body}`);
  },
);

export default router;
