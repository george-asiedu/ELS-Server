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

export default router;
