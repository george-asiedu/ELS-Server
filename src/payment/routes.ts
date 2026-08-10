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

// Verify a transaction after the Paystack redirect (any logged-in user).
router.get("/verify", authenticate, PaymentController.verify);

// Paystack server-to-server webhook (public; HMAC signature-verified).
router.post("/webhook", PaymentController.webhook);

export default router;
