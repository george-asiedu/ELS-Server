import { Router } from "express";
import multer from "multer";
import { AppointmentController } from "./appointmentController";
import { authenticate, requireAdmin, optionalAuth } from "../middleware/auth";

const router: Router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Public availability — which time slots are already taken for a date.
router.get("/availability", AppointmentController.availability);

// Create — guests and logged-in users both allowed; optional design image.
router.post(
  "/",
  optionalAuth,
  upload.single("designImage"),
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
