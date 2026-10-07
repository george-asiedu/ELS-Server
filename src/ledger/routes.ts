import { Router } from "express";
import { LedgerController } from "./ledgerController";
import { authenticate, requireAdmin } from "../middleware/auth";

const router: Router = Router();

// Studio admin only — their own studio's transaction ledger.
router.use(authenticate, requireAdmin);

router.get("/", LedgerController.list);
router.get("/summary", LedgerController.summary);
router.get("/:id", LedgerController.detail);

export default router;
