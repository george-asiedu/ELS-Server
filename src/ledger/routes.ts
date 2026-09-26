import { Router } from "express";
import { LedgerController } from "./ledgerController";
import { authenticate, requireAdmin } from "../middleware/auth";
import { reenterTenant } from "../middleware/tenant";

const router: Router = Router();

// Studio admin only — their own studio's transaction ledger.
router.use(authenticate, requireAdmin, reenterTenant);

router.get("/", LedgerController.list);
router.get("/summary", LedgerController.summary);
router.get("/:id", LedgerController.detail);

export default router;
