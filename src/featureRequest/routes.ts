import { Router } from "express";
import { FeatureRequestController } from "./featureRequestController";
import { authenticate, requireAdmin } from "../middleware/auth";

const router: Router = Router();

// Studio admins submit and review their own feature requests.
router.post("/", authenticate, requireAdmin, FeatureRequestController.create);
router.get("/", authenticate, requireAdmin, FeatureRequestController.listMine);

export default router;
