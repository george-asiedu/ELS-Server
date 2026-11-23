import { cachePublic } from "../cache/cache";
import { Request, Response, Router } from "express";
import { ApiError } from "../middleware/apiError";
import { createTenantClient } from "../tenant/tenantClient";

const { db } = createTenantClient();
import { BusinessHoursController } from "./businessHoursController";
import { authenticate, requireAdmin } from "../middleware/auth";

const router: Router = Router();

// Public
router.get("/", cachePublic(), BusinessHoursController.list);

// Closure days (holidays, training): public so the booking calendar can grey
// them out; admins add and remove them.
router.get("/closures", cachePublic(), async (_req: Request, res: Response) => {
  const today = new Date(
    new Date().toISOString().slice(0, 10) + "T00:00:00.000Z",
  );
  const data = await db.blockedDate.findMany({
    where: { date: { gte: today } },
    orderBy: { date: "asc" },
    take: 366,
  });
  return res.status(200).json({
    data: data.map((d) => ({
      id: d.id,
      date: d.date.toISOString().slice(0, 10),
      reason: d.reason,
    })),
  });
});
router.post(
  "/closures",
  authenticate,
  requireAdmin,
  async (req: Request, res: Response) => {
    const from = String(req.body?.from ?? "");
    const to = String(req.body?.to ?? from);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
      to < from
    )
      throw new ApiError(
        "Pick the day (or first and last day) you're closed",
        400,
      );
    const reason =
      typeof req.body?.reason === "string"
        ? req.body.reason.trim().slice(0, 80) || null
        : null;
    const days: Date[] = [];
    for (
      let d = new Date(`${from}T00:00:00.000Z`);
      d <= new Date(`${to}T00:00:00.000Z`) && days.length < 60;
      d.setUTCDate(d.getUTCDate() + 1)
    )
      days.push(new Date(d));
    const existing = new Set(
      (
        await db.blockedDate.findMany({
          where: { date: { in: days } },
          select: { date: true },
        })
      ).map((x) => x.date.getTime()),
    );
    const fresh = days.filter((d) => !existing.has(d.getTime()));
    if (fresh.length)
      await db.blockedDate.createMany({
        data: fresh.map((date) => ({ date, reason })),
      });
    return res.status(201).json({
      message:
        fresh.length === 1
          ? "Closure added"
          : `${fresh.length} closure days added`,
    });
  },
);
router.delete(
  "/closures/:id",
  authenticate,
  requireAdmin,
  async (req: Request, res: Response) => {
    await db.blockedDate.deleteMany({ where: { id: String(req.params.id) } });
    return res.status(200).json({ message: "Closure removed" });
  },
);

// Admin
router.put("/:id", authenticate, requireAdmin, BusinessHoursController.update);

export default router;
