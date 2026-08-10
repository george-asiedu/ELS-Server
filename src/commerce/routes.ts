import { Router } from "express";
import { CommerceController } from "./commerceController";
import { authenticate, requireAdmin } from "../middleware/auth";

const router: Router = Router();

// Public — the shop reads this to know if it's enabled + fulfillment options.
router.get("/settings", CommerceController.getSettings);

// Admin
router.put(
  "/settings",
  authenticate,
  requireAdmin,
  CommerceController.updateSettings,
);

export default router;
