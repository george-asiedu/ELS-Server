import { Router } from "express";
import { ContactController } from "./contactController";
import { authenticate, requireAdmin } from "../middleware/auth";

const router: Router = Router();

// Public
router.get("/", ContactController.get);

// Admin
router.put("/", authenticate, requireAdmin, ContactController.update);

export default router;
