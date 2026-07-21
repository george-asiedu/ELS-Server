import { Router } from "express";
import { BusinessHoursController } from "./businessHoursController";
import { authenticate, requireAdmin } from "../middleware/auth";

const router: Router = Router();

// Public
router.get("/", BusinessHoursController.list);

// Admin
router.put("/:id", authenticate, requireAdmin, BusinessHoursController.update);

export default router;
