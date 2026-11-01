import { cachePublic } from "../cache/cache";
import { Router } from "express";
import { ProductCategoryController } from "./productCategoryController";
import { authenticate, requireAdmin } from "../middleware/auth";

const router: Router = Router();

// Public — only visible (active) categories.
router.get("/", cachePublic(), ProductCategoryController.list);

// Admin
router.get(
  "/all",
  authenticate,
  requireAdmin,
  ProductCategoryController.listAll,
);
router.post("/", authenticate, requireAdmin, ProductCategoryController.create);
router.put(
  "/:id",
  authenticate,
  requireAdmin,
  ProductCategoryController.update,
);
router.delete(
  "/:id",
  authenticate,
  requireAdmin,
  ProductCategoryController.remove,
);

export default router;
