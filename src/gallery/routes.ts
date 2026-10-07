import { Router } from "express";
import { GalleryController } from "./galleryController";
import { authenticate, requireAdmin } from "../middleware/auth";

const router: Router = Router();

// Public
router.get("/", GalleryController.list);

// Admin
router.get("/all", authenticate, requireAdmin, GalleryController.listAll);
router.post("/", authenticate, requireAdmin, GalleryController.create);
router.delete("/:id", authenticate, requireAdmin, GalleryController.remove);

export default router;
