import { Router } from "express";
import { AppointmentController } from "./appointmentController";
import { authenticate, requireAdmin, optionalAuth } from "../middleware/auth";

const router: Router = Router();

// Create — guests and logged-in users both allowed.
router.post("/", optionalAuth, AppointmentController.create);

// Logged-in user's own appointments.
router.get("/me", authenticate, AppointmentController.listMine);

// Admin.
router.get("/", authenticate, requireAdmin, AppointmentController.listAll);
router.patch(
  "/:id/status",
  authenticate,
  requireAdmin,
  AppointmentController.updateStatus,
);
router.delete("/:id", authenticate, requireAdmin, AppointmentController.remove);

export default router;
