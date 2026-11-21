import { Router } from "express";
import { authenticate, requireAdmin } from "../middleware/auth";
import { getTenantContext } from "../tenant/context";
import { ApiError } from "../middleware/apiError";
import { insightsFor } from "./insightsService";
import { createTenantClient } from "../tenant/tenantClient";

const { raw } = createTenantClient();
const router: Router = Router();

// What happened and what to do about it, for the signed-in business.
router.get("/", authenticate, requireAdmin, async (req, res) => {
  const studioId = getTenantContext()?.studioId;
  if (!studioId) throw new ApiError("Open your own site to see insights", 400);
  // Business insights come with Premium and Zuri Stores plans.
  const studio = await raw.studio.findUnique({ where: { id: studioId }, select: { plan: true } });
  if (studio?.plan !== "PREMIUM" && studio?.plan !== "STOREFRONT") {
    return res.status(200).json({ data: null, locked: true, message: "Business insights are part of the Premium plan." });
  }
  const asked = Number(req.query.days);
  const days = [7, 30, 90].includes(asked) ? asked : 30;
  return res.status(200).json({ data: await insightsFor(studioId, days, req.query.refresh === "1") });
});

// The owner's insight settings: a monthly goal, the weekly email, urgent alerts.
const settingsFor = async (studioId: string) => {
  const row = (await raw.studioSettings.findUnique({ where: { studioId }, select: { revenueGoal: true, weeklyDigest: true, insightAlerts: true } })) ?? { revenueGoal: null, weeklyDigest: true, insightAlerts: true };
  return { goal: row.revenueGoal, weeklyDigest: row.weeklyDigest, alerts: row.insightAlerts };
};
router.get("/settings", authenticate, requireAdmin, async (_req, res) => {
  const studioId = getTenantContext()?.studioId;
  if (!studioId) throw new ApiError("Open your own site to see insights", 400);
  return res.status(200).json({ data: await settingsFor(studioId) });
});
router.put("/settings", authenticate, requireAdmin, async (req, res) => {
  const studioId = getTenantContext()?.studioId;
  if (!studioId) throw new ApiError("Open your own site to change insight settings", 400);
  const b = req.body ?? {};
  const data: { revenueGoal?: number | null; weeklyDigest?: boolean; insightAlerts?: boolean } = {};
  if (b.goal !== undefined) {
    if (b.goal === null || b.goal === "") data.revenueGoal = null;
    else {
      const g = Math.round(Number(b.goal) * 100) / 100;
      if (!Number.isFinite(g) || g <= 0 || g > 100_000_000) throw new ApiError("Enter a monthly goal above 0", 400);
      data.revenueGoal = g;
    }
  }
  if (b.weeklyDigest !== undefined) data.weeklyDigest = Boolean(b.weeklyDigest);
  if (b.alerts !== undefined) data.insightAlerts = Boolean(b.alerts);
  await raw.studioSettings.upsert({ where: { studioId }, update: data, create: { studioId, ...data } });
  return res.status(200).json({ message: "Saved", data: await settingsFor(studioId) });
});

export default router;
