import { Router } from "express";
import { PlatformReviewController } from "./platformReviewController";
import { authenticate, requireAdmin } from "../middleware/auth";

const router: Router = Router();

// Public — approved testimonials for the landing page.
router.get("/", PlatformReviewController.listApproved);

// Studio admin — submit and review their own testimonials.
router.post("/", authenticate, requireAdmin, PlatformReviewController.create);
router.get("/mine", authenticate, requireAdmin, PlatformReviewController.listMine);

export default router;
