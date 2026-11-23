import { Request, Response, Router } from "express";
import { authenticate, requireAdmin } from "../middleware/auth";
import { ApiError } from "../middleware/apiError";
import { createTenantClient } from "../tenant/tenantClient";
import { getTenantContext } from "../tenant/context";
import { MonthlyReportService } from "../reports/monthlyReport";

// Expenses and profit: what a business spent, against what it took in, by month.

const { db } = createTenantClient();
const router: Router = Router();
export const EXPENSE_CATEGORIES = [
  "Rent",
  "Products and supplies",
  "Salaries",
  "Utilities",
  "Marketing",
  "Equipment",
  "Transport",
  "Other",
];

const month = (raw: unknown) => {
  const m =
    typeof raw === "string" && /^\d{4}-\d{2}$/.test(raw)
      ? raw
      : new Date().toISOString().slice(0, 7);
  const from = new Date(`${m}-01T00:00:00.000Z`);
  const to = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1),
  );
  return { m, from, to };
};

router.use(authenticate, requireAdmin);

/** The month's expenses, its income, and the profit. */
router.get("/", async (req: Request, res: Response) => {
  const { m, from, to } = month(req.query.month);
  const studioId = getTenantContext()!.studioId!;
  const [items, income] = await Promise.all([
    db.expense.findMany({
      where: { date: { gte: from, lt: to } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
    new MonthlyReportService().figures(studioId, from, to),
  ]);
  const spent = Math.round(items.reduce((t, e) => t + e.amount, 0) * 100) / 100;
  const earned =
    Math.round((income.bookingRevenue + income.shopRevenue) * 100) / 100;
  const byCategory = EXPENSE_CATEGORIES.map((c) => ({
    category: c,
    amount:
      Math.round(
        items
          .filter((e) => e.category === c)
          .reduce((t, e) => t + e.amount, 0) * 100,
      ) / 100,
  })).filter((c) => c.amount > 0);
  return res.status(200).json({
    data: {
      month: m,
      items,
      categories: EXPENSE_CATEGORIES,
      summary: {
        earned,
        spent,
        profit: Math.round((earned - spent) * 100) / 100,
        byCategory,
      },
    },
  });
});

router.post("/", async (req: Request, res: Response) => {
  const b = req.body ?? {};
  const amount = Math.round(Number(b.amount) * 100) / 100;
  if (!(amount > 0)) throw new ApiError("Enter an amount", 400);
  const category = EXPENSE_CATEGORIES.includes(b.category)
    ? b.category
    : "Other";
  const date =
    typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date)
      ? new Date(`${b.date}T00:00:00.000Z`)
      : new Date();
  const created = await db.expense.create({
    data: {
      amount,
      category,
      date,
      description:
        typeof b.description === "string"
          ? b.description.trim().slice(0, 200) || null
          : null,
    },
  });
  return res.status(201).json({ message: "Expense added", data: created });
});

router.delete("/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!(await db.expense.findUnique({ where: { id } })))
    throw new ApiError("Expense not found", 404);
  await db.expense.delete({ where: { id } });
  return res.status(200).json({ message: "Expense removed" });
});

export default router;
