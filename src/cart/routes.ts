import { Router } from "express";
import { CartController } from "./cartController";
import { authenticate, requireCustomer } from "../middleware/auth";

const router: Router = Router();

// Cart is customer-only and always the logged-in user's own cart.
router.get("/", authenticate, requireCustomer, CartController.getMine);
router.post("/items", authenticate, requireCustomer, CartController.addItem);
router.put("/items", authenticate, requireCustomer, CartController.updateItem);
router.delete(
  "/items/:productId",
  authenticate,
  requireCustomer,
  CartController.removeItem,
);
router.delete("/", authenticate, requireCustomer, CartController.clear);

export default router;
