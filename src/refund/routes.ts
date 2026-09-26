import { Router } from "express";
import { RefundController } from "./refundController";
import { authenticate, requireAdmin } from "../middleware/auth";
import { reenterTenant } from "../middleware/tenant";

const router: Router = Router();

// Refunds move real money back to a customer, so they are studio-admin only.
router.use(authenticate, requireAdmin, reenterTenant);

router.get("/", RefundController.list);
router.post("/payments/:paymentId", RefundController.refundPayment);
router.post("/orders/:orderId", RefundController.refundOrder);

export default router;
