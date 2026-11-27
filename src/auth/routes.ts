import { Router } from "express";
import { AuthController } from "./authController";
import { authenticate } from "../middleware/auth";

const router: Router = Router();

router.post("/signup", AuthController.signup);
router.post("/login", AuthController.login);
router.post("/logout", authenticate, AuthController.logout);
router.get("/email-status", authenticate, AuthController.emailStatus);
router.post("/email-code", authenticate, AuthController.sendEmailCode);
router.post(
  "/email-code/confirm",
  authenticate,
  AuthController.confirmEmailCode,
);
router.get("/2fa", authenticate, AuthController.twoFactorStatus);
router.post("/2fa/setup", authenticate, AuthController.twoFactorSetup);
router.post("/2fa/enable", authenticate, AuthController.twoFactorEnable);
router.post("/2fa/disable", authenticate, AuthController.twoFactorDisable);
router.post(
  "/2fa/recovery-codes",
  authenticate,
  AuthController.twoFactorRecoveryCodes,
);
router.post("/first-visit", AuthController.firstVisitCode);
router.post("/first-visit/set-password", AuthController.firstVisitSetPassword);
router.post("/forgot-password", AuthController.forgotPassword);
router.post("/reset-password/:token", AuthController.resetPassword);

export default router;
