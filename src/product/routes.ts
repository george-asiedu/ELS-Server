import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import { ProductController } from "./productController";
import { authenticate, requireAdmin } from "../middleware/auth";
import { ApiError } from "../middleware/apiError";

const router: Router = Router();

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB product images

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new ApiError("Only image files are allowed", 400));
    }
  },
});

const uploadSingle = (req: Request, res: Response, next: NextFunction) => {
  upload.single("image")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return next(new ApiError("Image is too large. Maximum size is 10 MB.", 400));
      }
      return next(new ApiError(err.message, 400));
    }
    if (err) return next(err);
    return next();
  });
};

// Public
router.get("/", ProductController.list);

// Admin
router.get("/all", authenticate, requireAdmin, ProductController.listAll);
router.post("/", authenticate, requireAdmin, uploadSingle, ProductController.create);
router.put("/:id", authenticate, requireAdmin, uploadSingle, ProductController.update);
router.delete("/:id", authenticate, requireAdmin, ProductController.remove);

// Public single (kept after /all so it doesn't shadow it)
router.get("/:id", ProductController.getOne);

export default router;
