import { Router } from "express";
import { CategoryController } from "./categoryController";
import { authenticate, requireAdmin } from "../middleware/auth";

const router: Router = Router();

// Public — only visible (active) categories.
router.get("/", CategoryController.list);

// Admin
router.get("/all", authenticate, requireAdmin, CategoryController.listAll);
router.post("/", authenticate, requireAdmin, CategoryController.create);
router.put("/:id", authenticate, requireAdmin, CategoryController.update);
router.delete("/:id", authenticate, requireAdmin, CategoryController.remove);

export default router;
