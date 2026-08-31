import { Router } from "express";
import { PlatformController } from "./platformController";
import { FeatureRequestController } from "../featureRequest/featureRequestController";
import { PlatformReviewController } from "../platformReview/platformReviewController";
import { authenticate, requireSuperAdmin } from "../middleware/auth";

const router: Router = Router();

// Public: super-admin sign-in.
router.post("/auth/login", PlatformController.login);

// Everything below requires a signed-in super admin.
router.use(authenticate, requireSuperAdmin);

router.get("/me", PlatformController.me);
router.get("/analytics", PlatformController.analytics);

router.get("/studios", PlatformController.listStudios);
router.post("/studios", PlatformController.createStudio);
router.get("/studios/:id", PlatformController.getStudio);
router.patch("/studios/:id", PlatformController.updateStudio);
router.patch("/studios/:id/status", PlatformController.setStatus);
router.patch("/studios/:id/settings", PlatformController.updateSettings);
router.post("/studios/:id/impersonate", PlatformController.impersonate);

// Testimonials moderation (studio-submitted → approved for the landing).
router.get("/reviews", PlatformReviewController.listAll);
router.patch("/reviews/:id", PlatformReviewController.setApproved);
router.delete("/reviews/:id", PlatformReviewController.remove);

// Audit trail of platform actions.
router.get("/audit-logs", PlatformController.listAudit);

// Feature-request triage across all studios.
router.get("/feature-requests", FeatureRequestController.platformList);
router.patch(
  "/feature-requests/:id",
  FeatureRequestController.platformUpdateStatus,
);

export default router;
