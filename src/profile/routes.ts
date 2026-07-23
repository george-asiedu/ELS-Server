import { Router } from "express";
import { ProfileController } from "./profileController";
import { authenticate } from "../middleware/auth";
import multer from "multer";

const router: Router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get('/me', authenticate, ProfileController.handleGetMyProfile);
router.post('/me', authenticate, upload.single('image'), ProfileController.upsertMyProfile);
router.post('/me/password', authenticate, ProfileController.handleChangeMyPassword);
router.post('/:userId', upload.single('image'), ProfileController.create);
router.get('/:userId', ProfileController.handleGetProfile);
router.delete('/:userId', ProfileController.handleDeleteProfile);
router.delete('/user/:id', ProfileController.handleDeleteUser);
router.post('/change-password/:id', ProfileController.handleUpdatePassword);
router.post('/update-email/:id', ProfileController.handleUpdateEmail);

export default router;
