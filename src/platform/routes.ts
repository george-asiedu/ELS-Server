import { billingAdminRoutes } from "./billingAdmin";
import { bumpVersion, cachePublic } from "../cache/cache";
import { Router } from "express";
import { AuthController } from "../auth/authController";
import pushRoutes from "../push/routes";
import inboxRoutes from "../push/inboxRoutes";
import { PlatformController } from "./platformController";
import { FeatureRequestController } from "../featureRequest/featureRequestController";
import { PlatformReviewController } from "../platformReview/platformReviewController";
import { authenticate, requireSuperAdmin } from "../middleware/auth";
import { getQueueStatus } from "../queue/queueStatus";
import { SchedulerController } from "../scheduler/schedulerController";
import { PlatformActivityLogService } from "./platformActivityLog";
import { LedgerController } from "../ledger/ledgerController";
import { UserDirectoryController } from "../users/userDirectoryController";
import { AuditService } from "../audit/auditService";
import {
  currentGuestKey,
  guestKeyFetchLimiter,
  guestKeyStatus,
  rotateGuestKey,
} from "../middleware/guestKey";

const audit = new AuditService();
import {
  platformStorageSettings,
  savePlatformStorageSettings,
  storageSummary,
} from "../storage/storageService";
import {
  platformList as platformTrainingList,
  platformUpdate as platformTrainingUpdate,
  saveSettings as saveTrainingSettings,
  settings as trainingSettings,
  platformReservations as platformTrainingReservations,
} from "../training/trainingService";

const activityLogs = new PlatformActivityLogService();

const router: Router = Router();

// Public: super-admin sign-in.
router.post("/auth/login", PlatformController.login);
router.post("/auth/forgot-password", PlatformController.forgotPassword);
router.post("/auth/reset-password", PlatformController.resetPassword);

// Public: site details, prices and setup fees for the platform pages.
router.get("/public-config", cachePublic(), PlatformController.publicConfig);
// The web app reads the current guest key here (never cached, so a rotation
// reaches it straight away).
router.get("/guest-key", guestKeyFetchLimiter, async (_req, res) => {
  res.set("Cache-Control", "no-store");
  return res.status(200).json({ data: { key: await currentGuestKey() } });
});
router.get("/public-stats", cachePublic(300), PlatformController.publicStats);
router.get("/directory", cachePublic(300), PlatformController.directory);

// Everything below requires a signed-in super admin.
router.use(authenticate, requireSuperAdmin);
router.post("/auth/logout", PlatformController.logout);
// Two-step sign-in for the super admin's own account.
router.get("/auth/2fa", AuthController.twoFactorStatus);
router.post("/auth/2fa/setup", AuthController.twoFactorSetup);
router.post("/auth/2fa/enable", AuthController.twoFactorEnable);
router.post("/auth/2fa/disable", AuthController.twoFactorDisable);
router.post("/auth/2fa/recovery-codes", AuthController.twoFactorRecoveryCodes);
router.use("/push", pushRoutes);
router.use("/inbox", inboxRoutes);

router.get("/me", PlatformController.me);
router.use(billingAdminRoutes);
router.get("/analytics", PlatformController.analytics);
router.get("/earnings", PlatformController.earnings);
router.get("/billing-config", PlatformController.getBillingConfig);
router.patch("/billing-config", PlatformController.updateBillingConfig);
router.get("/guest-key/status", async (_req, res) =>
  res.status(200).json({ data: await guestKeyStatus() }),
);
router.post("/guest-key/rotate", async (req, res) => {
  const data = await rotateGuestKey();
  await audit.record({
    actor: { id: req.user.id, email: req.user.email, role: req.user.role },
    action: "platform.guest_key.rotated",
    targetType: "PlatformConfig",
    metadata: { endsWith: data.endsWith },
  });
  return res.status(200).json({
    message: "Guest key rotated. The old one works for 24 more hours.",
    data,
  });
});
router.get("/site-settings", PlatformController.getSiteSettings);
router.patch("/site-settings", PlatformController.updateSiteSettings);

// Just ids and names, for filter menus. Declared before /studios/:id.
router.get("/studios/options", PlatformController.listStudioOptions);
router.get("/studios", PlatformController.listStudios);
router.post("/studios", PlatformController.createStudio);
router.get("/studios/:id", PlatformController.getStudio);
router.patch("/studios/:id", PlatformController.updateStudio);
router.patch("/studios/:id/status", PlatformController.setStatus);
router.delete("/studios/:id", PlatformController.deleteStudio);
router.patch("/studios/:id/settings", PlatformController.updateSettings);
router.post("/studios/:id/impersonate", PlatformController.impersonate);

// Users across every studio (customers and studio admins).
router.get("/users", UserDirectoryController.platformList);
router.get("/users/:id", UserDirectoryController.platformDetail);
router.patch("/users/:id", UserDirectoryController.platformUpdate);
router.delete("/users/:id", UserDirectoryController.platformRemove);
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

// Transaction ledger: pass ?studioId= for one studio, omit it for platform-wide.
router.get("/transactions", LedgerController.platformList);
router.get("/transactions/summary", LedgerController.platformSummary);

// Audit trail of platform actions.
router.get("/audit-logs", PlatformController.listAudit);

router.get("/activity-logs", async (req, res, next) => {
  try {
    const cursor =
      typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limitValue =
      typeof req.query.limit === "string" ? req.query.limit : undefined;
    const studioId =
      typeof req.query.studioId === "string" ? req.query.studioId : undefined;
    const method =
      typeof req.query.method === "string" ? req.query.method : undefined;
    const statusCode =
      typeof req.query.statusCode === "string"
        ? Number(req.query.statusCode)
        : undefined;
    if (
      statusCode !== undefined &&
      ![200, 300, 400, 500].includes(statusCode)
    ) {
      return res
        .status(400)
        .json({ message: "statusCode must be one of 200, 300, 400, or 500" });
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

// Background email queue — read-only.
router.get("/queues", getQueueStatus);

// Recurring jobs (reconciliation, reminders): list, switch on/off, run now.
router.get("/jobs", SchedulerController.list);
router.patch("/jobs/:key", SchedulerController.setEnabled);
router.post("/jobs/:key/run", SchedulerController.runNow);

// Feature-request triage across all studios.
router.get("/storage-settings", async (_req, res) =>
  res.status(200).json({ data: await platformStorageSettings() }),
);
router.patch("/storage-settings", async (req, res) => {
  const data = await savePlatformStorageSettings(req.body ?? {});
  // The plan cards on the website show these, so don't let a cached copy linger.
  await bumpVersion("all");
  await audit.record({
    actor: { id: req.user.id, email: req.user.email, role: req.user.role },
    action: "platform.storage_settings.updated",
    targetType: "PlatformConfig",
    metadata: data,
  });
  return res.status(200).json({ message: "Storage plans saved", data });
});
router.get("/studios/:id/storage", async (req, res) =>
  res.status(200).json({
    data: await storageSummary(
      String(req.params.id),
      req.query.refresh === "1",
    ),
  }),
);
router.get("/training", async (_req, res) =>
  res.status(200).json({
    data: await platformTrainingList(),
    settings: await trainingSettings(),
    reservations: await platformTrainingReservations(),
  }),
);
router.patch("/training/settings", async (req, res) =>
  res.status(200).json({
    message: "Saved",
    data: await saveTrainingSettings(req.body ?? {}),
  }),
);
router.patch("/training/:id", async (req, res) =>
  res.status(200).json({
    message: "Updated",
    data: await platformTrainingUpdate(String(req.params.id), req.body ?? {}),
  }),
);
router.get("/feature-requests", FeatureRequestController.platformList);
router.patch(
  "/feature-requests/:id/fee",
  FeatureRequestController.platformSetFee,
);
router.patch(
  "/feature-requests/:id",
  FeatureRequestController.platformUpdateStatus,
);

export default router;
