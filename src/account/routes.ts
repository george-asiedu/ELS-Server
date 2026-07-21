import { Router } from "express";
import { AccountController } from "./accountController";
import { authenticate } from "../middleware/auth";

const router: Router = Router();

router.get("/loyalty", authenticate, AccountController.loyalty);
router.get("/loyalty/transactions", authenticate, AccountController.transactions);
router.post("/loyalty/redeem", authenticate, AccountController.redeem);
router.get("/referral", authenticate, AccountController.referral);

export default router;
