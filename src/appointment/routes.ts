import { Router } from "express";
import { AppointmentController } from "./appointmentController";
import { authenticate, requireAdmin, requireCustomer } from "../middleware/auth";

const router: Router = Router();

// Public availability — which time slots are already taken for a date.
router.get("/availability", AppointmentController.availability);

// Create — customer accounts only (no guests, no admins); optional design image.
router.post(
  "/",
  authenticate,
  requireCustomer,
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
// Move a booking to a new slot. Open to any signed-in user: the controller
// reads the role from the session and the service applies the matching rules —
// a customer may only move their OWN booking, must give the studio's required
// notice and stay inside opening hours, and the booking drops to
// PENDING_RESCHEDULE for the studio to approve. An admin move is final.
router.patch(
  "/:id/reschedule",
  authenticate,
  AppointmentController.reschedule,
);
// Swap the booked service. Admin-only: it re-prices the booking and can
// trigger a refund or leave a balance due.
router.patch(
  "/:id/service",
  authenticate,
  requireAdmin,
  AppointmentController.changeService,
);
router.delete("/:id", authenticate, requireAdmin, AppointmentController.remove);

export default router;
