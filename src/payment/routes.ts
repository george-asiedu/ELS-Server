import { Router } from "express";
import { PaymentController } from "./paymentController";
import {
  authenticate,
  requireAdmin,
  requireCustomer,
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
  PaymentController.chargeMomo,
);
// Submit an OTP if the mobile-money charge asks for one.
router.post(
  "/charge/submit-otp",
  authenticate,
  requireCustomer,
  PaymentController.submitOtp,
);
// Poll a charge's status (mobile money or inline popup).
router.get("/status", authenticate, PaymentController.status);

// Verify a transaction after the Paystack redirect (any logged-in user).
router.get("/verify", authenticate, PaymentController.verify);

// Verify a combined booking + products charge (customer).
router.get("/verify-combined", authenticate, PaymentController.verifyCombined);

// Paystack server-to-server webhook (public; HMAC signature-verified).
router.post("/webhook", PaymentController.webhook);

export default router;
