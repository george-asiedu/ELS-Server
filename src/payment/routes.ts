import { Router } from "express";
import { guestLimiter, requireGuestKey } from "../middleware/guestKey";
import { requireCaptcha } from "../middleware/captcha";
import { PaymentController } from "./paymentController";
import {
  authenticate,
  requireAdmin,
  requireCustomer,
  optionalAuth,
} from "../middleware/auth";

const router: Router = Router();

// Public — booking page reads the policy to render payment options.
router.get("/settings", PaymentController.getSettings);

// Admin — set the payment policy.
router.put(
  "/settings",
  authenticate,
  requireAdmin,
  PaymentController.updateSettings,
);

// Customer — start a Paystack transaction for their own booking.
router.post(
  "/initialize",
  authenticate,
  requireCustomer,
  PaymentController.initialize,
);

// Customer — mobile-money charge (phone prompt) for their own booking.
router.post(
  "/charge/momo",
  authenticate,
  requireCustomer,
  requireCaptcha,
  PaymentController.chargeMomo,
);
// Submit an OTP if the mobile-money charge asks for one.
router.post("/charge/submit-otp", optionalAuth, PaymentController.submitOtp);
// Poll a charge's status (mobile money or inline popup).
router.get("/status", optionalAuth, PaymentController.status);

// Verify a transaction after the Paystack redirect (any logged-in user).
router.get("/verify", optionalAuth, PaymentController.verify);

// Verify a combined booking + products charge (customer).
router.get("/verify-combined", authenticate, PaymentController.verifyCombined);

// Guest — a booking made without an account is paid with its private token.
// Status, OTP and verify work off the payment reference, which can't be guessed,
// so they don't need a signed-in user.
router.post(
  "/guest/initialize",
  guestLimiter,
  requireGuestKey,
  PaymentController.guestInitialize,
);
router.post(
  "/guest/charge/momo",
  guestLimiter,
  requireGuestKey,
  requireCaptcha,
  PaymentController.guestChargeMomo,
);

// Paystack server-to-server webhook (public; HMAC signature-verified).
router.post("/webhook", PaymentController.webhook);

export default router;
