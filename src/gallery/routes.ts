import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import { GalleryController } from "./galleryController";
import { authenticate, requireAdmin } from "../middleware/auth";
import { ApiError } from "../middleware/apiError";

const router: Router = Router();

// Max upload size for gallery media (images and videos). 100 MB comfortably
// covers short showcase clips while capping memory use.
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  // Accept any image or video format; the size limit is enforced separately.
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/") || file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new ApiError("Only image or video files are allowed", 400));
    }
  },
});

// Wrap multer so its errors (e.g. file-too-large) become clean API errors.
const uploadSingle = (req: Request, res: Response, next: NextFunction) => {
  upload.single("image")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return next(new ApiError("File is too large. Maximum size is 100 MB.", 400));
      }
      return next(new ApiError(err.message, 400));
    }
    if (err) return next(err);
    return next();
  });
};

// Public
router.get("/", GalleryController.list);

// Admin
router.get("/all", authenticate, requireAdmin, GalleryController.listAll);
router.post("/", authenticate, requireAdmin, uploadSingle, GalleryController.create);
router.delete("/:id", authenticate, requireAdmin, GalleryController.remove);

export default router;
