import { Router } from "express";
import multer from "multer";
import { GalleryController } from "./galleryController";
import { authenticate, requireAdmin } from "../middleware/auth";

const router: Router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Public
router.get("/", GalleryController.list);

// Admin
router.get("/all", authenticate, requireAdmin, GalleryController.listAll);
router.post(
  "/",
  authenticate,
  requireAdmin,
  upload.single("image"),
  GalleryController.create,
);
router.delete("/:id", authenticate, requireAdmin, GalleryController.remove);

export default router;
