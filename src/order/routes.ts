import { Router } from "express";
import { guestLimiter, requireGuestKey } from "../middleware/guestKey";
import { requireCaptcha } from "../middleware/captcha";
import { OrderController } from "./orderController";
import {
  authenticate,
  requireAdmin,
  requireCustomer,
} from "../middleware/auth";

const router: Router = Router();

router.post("/coupon", OrderController.checkCoupon);

// Customer
router.post(
  "/checkout",
  authenticate,
  requireCustomer,
  OrderController.checkout,
);
router.post(
  "/booking-checkout",
  authenticate,
  requireCustomer,
  OrderController.bookingCheckout,
);
router.get("/me", authenticate, requireCustomer, OrderController.listMine);
router.post("/:id/repay", authenticate, requireCustomer, OrderController.repay);

// Guest checkout (no account) — anyone can buy a product.
router.post(
  "/guest-checkout",
  guestLimiter,
  requireGuestKey,
  requireCaptcha,
  OrderController.guestCheckout,
);

// Pay a waiting order with Mobile Money from the checkout page (guests too).
// The order's reference is the secret; the security check guards the prompt.
router.post(
  "/charge/momo",
  guestLimiter,
  requireCaptcha,
  OrderController.chargeMomo,
);

// Verify a transaction after the Paystack redirect (public: guests too).
router.get("/verify", OrderController.verify);

// Admin
router.get("/", authenticate, requireAdmin, OrderController.listAll);
router.patch(
  "/:id/status",
  authenticate,
  requireAdmin,
  OrderController.updateStatus,
);

export default router;
