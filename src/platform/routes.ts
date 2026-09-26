import { Router } from "express";
import { PlatformController } from "./platformController";
import { FeatureRequestController } from "../featureRequest/featureRequestController";
import { PlatformReviewController } from "../platformReview/platformReviewController";
import { authenticate, requireSuperAdmin } from "../middleware/auth";
import { getQueueStatus } from "../queue/queueStatus";
import { PlatformActivityLogService } from "./platformActivityLog";
import { LedgerController } from "../ledger/ledgerController";

const activityLogs = new PlatformActivityLogService();

const router: Router = Router();

// Public: super-admin sign-in.
router.post("/auth/login", PlatformController.login);
router.post("/auth/forgot-password", PlatformController.forgotPassword);
router.post("/auth/reset-password", PlatformController.resetPassword);

// Everything below requires a signed-in super admin.
router.use(authenticate, requireSuperAdmin);
router.post("/auth/logout", PlatformController.logout);

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
// Help a studio admin who can't sign in: emails THEM a reset link. There is no
// endpoint that reveals a password — hashes are one-way.
router.post(
  "/studios/:id/send-password-reset",
  PlatformController.sendStudioAdminPasswordReset,
);

// Testimonials moderation (studio-submitted → approved for the landing).
router.get("/reviews", PlatformReviewController.listAll);
router.patch("/reviews/:id", PlatformReviewController.setApproved);
router.delete("/reviews/:id", PlatformReviewController.remove);

// Per-studio transaction ledger (pass ?studioId=, omit it for platform-wide).
router.get("/transactions", LedgerController.platformList);
router.get("/transactions/summary", LedgerController.platformSummary);
router.get("/studios/:studioId/transactions", LedgerController.platformList);
router.get(
  "/studios/:studioId/transactions/summary",
  LedgerController.platformSummary,
);

// Audit trail of platform actions.
router.get("/audit-logs", PlatformController.listAudit);

router.get("/activity-logs", async (req, res, next) => {
  try {
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limitValue = typeof req.query.limit === "string" ? req.query.limit : undefined;
    const studioId = typeof req.query.studioId === "string" ? req.query.studioId : undefined;
    const method = typeof req.query.method === "string" ? req.query.method : undefined;
    const statusCode = typeof req.query.statusCode === "string" ? Number(req.query.statusCode) : undefined;
    if (statusCode !== undefined && (![200, 300, 400, 500].includes(statusCode))) {
      return res.status(400).json({ message: "statusCode must be one of 200, 300, 400, or 500" });
    }
    const result = await activityLogs.list({
      ...(cursor ? { cursor } : {}),
      limit: limitValue === undefined ? 50 : Number(limitValue),
      ...(studioId ? { studioId } : {}),
      ...(method ? { method } : {}),
      ...(statusCode !== undefined ? { statusCode } : {}),
    });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
});

// Background job queues (email sending, payment reconciliation) — read-only.
router.get("/queues", getQueueStatus);

// Feature-request triage across all studios.
router.get("/feature-requests", FeatureRequestController.platformList);
router.patch(
  "/feature-requests/:id",
  FeatureRequestController.platformUpdateStatus,
);

export default router;
