import { Router } from "express";
import { ProfileController } from "./profileController";
import { authenticate, requireAdmin } from "../middleware/auth";
import { reenterTenant } from "../middleware/tenant";
import multer from "multer";
import { ApiError } from "../middleware/apiError";

const router: Router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 30 },
  fileFilter: (_req, file, cb) => file.mimetype.startsWith("image/")
    ? cb(null, true)
    : cb(new ApiError("Only image files are allowed", 400)),
});

router.get('/me', authenticate, ProfileController.handleGetMyProfile);
router.post('/me', authenticate, upload.single('image'), reenterTenant, ProfileController.upsertMyProfile);
router.post('/me/password', authenticate, ProfileController.handleChangeMyPassword);
router.post('/:userId', authenticate, upload.single('image'), reenterTenant, ProfileController.create);
router.get('/:userId', authenticate, ProfileController.handleGetProfile);
router.delete('/:userId', authenticate, requireAdmin, ProfileController.handleDeleteProfile);
router.delete('/user/:id', authenticate, requireAdmin, ProfileController.handleDeleteUser);
router.post('/change-password/:id', authenticate, requireAdmin, ProfileController.handleUpdatePassword);
router.post('/update-email/:id', authenticate, requireAdmin, ProfileController.handleUpdateEmail);

export default router;
