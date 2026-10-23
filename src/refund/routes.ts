import { Router } from "express";
import { RefundController } from "./refundController";
import { authenticate, requireAdmin } from "../middleware/auth";

const router: Router = Router();

// Refunds move real money back to a customer, so they are studio-admin only.
router.use(authenticate, requireAdmin);

router.get("/", RefundController.list);
router.post("/payments/:paymentId", RefundController.refundPayment);
router.post("/orders/:orderId", RefundController.refundOrder);

export default router;
