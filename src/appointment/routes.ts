import { Router } from "express";
import multer from "multer";
import { AppointmentController } from "./appointmentController";
import { authenticate, requireAdmin, requireCustomer } from "../middleware/auth";
import { reenterTenant } from "../middleware/tenant";
import { ApiError } from "../middleware/apiError";

const router: Router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 30 },
  fileFilter: (_req, file, cb) => file.mimetype.startsWith("image/")
    ? cb(null, true)
    : cb(new ApiError("Only image files are allowed", 400)),
});

// Public availability — which time slots are already taken for a date.
router.get("/availability", AppointmentController.availability);

// Create — customer accounts only (no guests, no admins); optional design image.
router.post(
  "/",
  authenticate,
  requireCustomer,
  upload.single("designImage"),
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
