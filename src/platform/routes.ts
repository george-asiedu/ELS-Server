import { Router } from "express";
import { PlatformController } from "./platformController";
import { FeatureRequestController } from "../featureRequest/featureRequestController";
import { PlatformReviewController } from "../platformReview/platformReviewController";
import { authenticate, requireSuperAdmin } from "../middleware/auth";
import { getQueueStatus } from "../queue/queueStatus";

const router: Router = Router();

// Public: super-admin sign-in.
router.post("/auth/login", PlatformController.login);
router.post("/auth/forgot-password", PlatformController.forgotPassword);
router.post("/auth/reset-password", PlatformController.resetPassword);

// Everything below requires a signed-in super admin.
router.use(authenticate, requireSuperAdmin);

router.get("/me", PlatformController.me);
router.get("/analytics", PlatformController.analytics);
router.get("/billing-config", PlatformController.getBillingConfig);
router.patch("/billing-config", PlatformController.updateBillingConfig);

router.get("/studios", PlatformController.listStudios);
router.post("/studios", PlatformController.createStudio);
router.get("/studios/:id", PlatformController.getStudio);
router.patch("/studios/:id", PlatformController.updateStudio);
router.patch("/studios/:id/status", PlatformController.setStatus);
router.delete("/studios/:id", PlatformController.deleteStudio);
router.patch("/studios/:id/settings", PlatformController.updateSettings);
router.post("/studios/:id/impersonate", PlatformController.impersonate);

// Testimonials moderation (studio-submitted → approved for the landing).
router.get("/reviews", PlatformReviewController.listAll);
router.patch("/reviews/:id", PlatformReviewController.setApproved);
router.delete("/reviews/:id", PlatformReviewController.remove);

// Audit trail of platform actions.
router.get("/audit-logs", PlatformController.listAudit);

// Background job queues (email sending, payment reconciliation) — read-only.
router.get("/queues", getQueueStatus);

// Feature-request triage across all studios.
router.get("/feature-requests", FeatureRequestController.platformList);
router.patch(
  "/feature-requests/:id",
  FeatureRequestController.platformUpdateStatus,
);

export default router;
