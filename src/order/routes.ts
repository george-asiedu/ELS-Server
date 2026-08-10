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
router.get("/me", authenticate, requireCustomer, OrderController.listMine);
router.get("/verify", authenticate, OrderController.verify);

// Admin
router.get("/", authenticate, requireAdmin, OrderController.listAll);
router.patch(
  "/:id/status",
  authenticate,
  requireAdmin,
  OrderController.updateStatus,
);

export default router;
