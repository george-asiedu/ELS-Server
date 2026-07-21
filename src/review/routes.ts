import { Router } from "express";
import { ReviewController } from "./reviewController";
import { authenticate, requireAdmin } from "../middleware/auth";

const router: Router = Router();

// Public
router.get("/", ReviewController.listApproved);

// Authenticated user
router.post("/", authenticate, ReviewController.create);

// Admin
router.get("/all", authenticate, requireAdmin, ReviewController.listAll);
router.patch("/:id/approve", authenticate, requireAdmin, ReviewController.approve);
router.delete("/:id", authenticate, requireAdmin, ReviewController.remove);

export default router;
