import { Router } from "express";
import { ProductController } from "./productController";
import { authenticate, requireAdmin } from "../middleware/auth";
import { reenterTenant } from "../middleware/tenant";

const router: Router = Router();

// Public
router.get("/", ProductController.list);

// Admin
router.get("/all", authenticate, requireAdmin, ProductController.listAll);
router.post("/", authenticate, requireAdmin, reenterTenant, ProductController.create);
router.put("/:id", authenticate, requireAdmin, reenterTenant, ProductController.update);
router.delete("/:id", authenticate, requireAdmin, ProductController.remove);

// Public single (kept after /all so it doesn't shadow it)
router.get("/:id", ProductController.getOne);

export default router;
