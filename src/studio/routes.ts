import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import { StudioController } from "./studioController";
import { authenticate, requireAdmin } from "../middleware/auth";
import { reenterTenant } from "../middleware/tenant";
import { ApiError } from "../middleware/apiError";

const router: Router = Router();

const MAX_LOGO_BYTES = 4 * 1024 * 1024; // 4 MB logos

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_LOGO_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new ApiError("Only image files are allowed", 400));
    }
  },
});

const uploadLogo = (req: Request, res: Response, next: NextFunction) => {
  upload.single("logo")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return next(new ApiError("Logo is too large. Maximum size is 4 MB.", 400));
      }
      return next(new ApiError(err.message, 400));
    }
    if (err) return next(err);
    return next();
  });
};

// Public: the current studio's branding/content/feature config for the SPA.
router.get("/", StudioController.config);

// Admin: the studio owner edits their own branding + landing content.
router.get("/branding", authenticate, requireAdmin, StudioController.getBranding);
router.put(
  "/branding",
  authenticate,
  requireAdmin,
  uploadLogo,
  reenterTenant,
  StudioController.updateBranding,
);
router.get("/content", authenticate, requireAdmin, StudioController.getContent);
router.put("/content", authenticate, requireAdmin, StudioController.updateContent);

export default router;
