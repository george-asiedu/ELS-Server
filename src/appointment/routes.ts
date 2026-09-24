import { Router } from "express";
import { AppointmentController } from "./appointmentController";
import { authenticate, requireAdmin, requireCustomer } from "../middleware/auth";
import { reenterTenant } from "../middleware/tenant";

const router: Router = Router();

// Public availability — which time slots are already taken for a date.
router.get("/availability", AppointmentController.availability);

// Create — customer accounts only (no guests, no admins); optional design image.
router.post(
  "/",
  authenticate,
  requireCustomer,
  reenterTenant,
  AppointmentController.create,
);

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
