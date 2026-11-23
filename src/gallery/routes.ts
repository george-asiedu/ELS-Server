import { cachePublic } from "../cache/cache";
import { Router } from "express";
import { GalleryController } from "./galleryController";
import { authenticate, requireAdmin } from "../middleware/auth";

const router: Router = Router();

// Public
router.get("/", cachePublic(), GalleryController.list);

// Admin
router.get("/all", authenticate, requireAdmin, GalleryController.listAll);
router.post("/", authenticate, requireAdmin, GalleryController.create);
router.get("/trash", authenticate, requireAdmin, GalleryController.listTrash);
router.post(
  "/:id/restore",
  authenticate,
  requireAdmin,
  GalleryController.restore,
);
router.delete(
  "/:id/purge",
  authenticate,
  requireAdmin,
  GalleryController.purge,
);
router.patch("/:id", authenticate, requireAdmin, GalleryController.update);
router.delete("/:id", authenticate, requireAdmin, GalleryController.remove);

export default router;
