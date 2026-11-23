import { cachePublic } from "../cache/cache";
import { Router } from "express";
import { StudioController } from "./studioController";
import { authenticate, requireAdmin } from "../middleware/auth";
import { UserDirectoryController } from "../users/userDirectoryController";

const router: Router = Router();

// Public: the current studio's branding/content/feature config for the SPA.
router.get("/", cachePublic(), StudioController.config);

// Public: the studio's real numbers for its website's metrics strip.
router.get("/stats", cachePublic(300), StudioController.getPublicStats);

// Public: resolve a custom domain (host) to a studio slug (SPA bootstrap).
router.get("/resolve-domain", StudioController.resolveDomain);

// Admin: this studio's customers and admins, read-only (editing and
// deleting accounts is for the super admin).
router.get(
  "/users",
  authenticate,
  requireAdmin,
  UserDirectoryController.studioList,
);
router.get(
  "/users/:id",
  authenticate,
  requireAdmin,
  UserDirectoryController.studioDetail,
);
// The business's private notes about a customer.
router.put(
  "/users/:id/notes",
  authenticate,
  requireAdmin,
  UserDirectoryController.studioNotes,
);

// Admin: what customers paid and what Paystack has paid out to the studio.
router.get("/money", authenticate, requireAdmin, StudioController.getMoney);

// Admin: custom domain management.
router.get("/domain", authenticate, requireAdmin, StudioController.getDomain);
router.put("/domain", authenticate, requireAdmin, StudioController.setDomain);
router.post(
  "/domain/verify",
  authenticate,
  requireAdmin,
  StudioController.verifyDomain,
);

// Admin: the studio owner edits their own branding + landing content.
router.get(
  "/branding",
  authenticate,
  requireAdmin,
  StudioController.getBranding,
);
router.put(
  "/branding",
  authenticate,
  requireAdmin,
  StudioController.updateBranding,
);
router.get("/content", authenticate, requireAdmin, StudioController.getContent);
router.put(
  "/content",
  authenticate,
  requireAdmin,
  StudioController.updateContent,
);

// Admin: payout account (Paystack subaccount) for split settlement.
// Billing: view + change plan/cadence.
router.get("/billing", authenticate, requireAdmin, StudioController.getBilling);
router.post(
  "/billing/change",
  authenticate,
  requireAdmin,
  StudioController.startBillingChange,
);
router.post(
  "/billing/apply",
  authenticate,
  requireAdmin,
  StudioController.applyBillingChange,
);
router.post(
  "/billing/renew",
  authenticate,
  requireAdmin,
  StudioController.startRenewal,
);
router.post(
  "/billing/extras",
  authenticate,
  requireAdmin,
  StudioController.startExtrasPayment,
);
router.post(
  "/billing/extras/apply",
  authenticate,
  requireAdmin,
  StudioController.applyExtrasPayment,
);
router.post(
  "/billing/renew/apply",
  authenticate,
  requireAdmin,
  StudioController.applyRenewal,
);

router.get("/loyalty", authenticate, requireAdmin, StudioController.getLoyalty);
router.put(
  "/loyalty",
  authenticate,
  requireAdmin,
  StudioController.updateLoyalty,
);
router.get("/payout", authenticate, requireAdmin, StudioController.getPayout);
// Who pays Paystack's fee on customer payments: the customer or the business.
router.get(
  "/messaging",
  authenticate,
  requireAdmin,
  StudioController.getMessaging,
);
// Invite another business: the invite link and how many joined through it.
router.get("/referrals", authenticate, requireAdmin, async (req, res) => {
  const { referralSummary } = await import("../billing/businessReferral");
  return res.status(200).json({ data: await referralSummary(req.studioId!) });
});
router.put(
  "/messaging",
  authenticate,
  requireAdmin,
  StudioController.setMessaging,
);
router.get(
  "/fee-payer",
  authenticate,
  requireAdmin,
  StudioController.getFeePayer,
);
router.put(
  "/fee-payer",
  authenticate,
  requireAdmin,
  StudioController.setFeePayer,
);
router.get(
  "/payout/resolve",
  authenticate,
  requireAdmin,
  StudioController.resolvePayout,
);
router.put(
  "/payout",
  authenticate,
  requireAdmin,
  StudioController.updatePayout,
);

export default router;
