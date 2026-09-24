import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import { ServiceController } from "./serviceController";
import { authenticate, requireAdmin } from "../middleware/auth";
import { reenterTenant } from "../middleware/tenant";
import { ApiError } from "../middleware/apiError";

const router: Router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new ApiError("Only image files are allowed", 400));
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
router.get("/", ServiceController.list);

// Admin
router.get("/all", authenticate, requireAdmin, ServiceController.listAll);
router.post("/", authenticate, requireAdmin, uploadSingle, reenterTenant, ServiceController.create);
router.put("/:id", authenticate, requireAdmin, uploadSingle, reenterTenant, ServiceController.update);
router.delete("/:id", authenticate, requireAdmin, ServiceController.remove);

// Public single (kept after /all so it doesn't shadow it)
router.get("/:id", ServiceController.getOne);

export default router;
