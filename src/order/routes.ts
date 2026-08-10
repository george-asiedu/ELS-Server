import { Router } from "express";
import { OrderController } from "./orderController";
import {
  authenticate,
  requireAdmin,
  requireCustomer,
} from "../middleware/auth";

const router: Router = Router();

// Customer
router.post("/checkout", authenticate, requireCustomer, OrderController.checkout);
router.post(
  "/booking-checkout",
  authenticate,
  requireCustomer,
  OrderController.bookingCheckout,
);
router.get("/me", authenticate, requireCustomer, OrderController.listMine);

// Guest checkout (no account) — anyone can buy a product.
router.post("/guest-checkout", OrderController.guestCheckout);

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
