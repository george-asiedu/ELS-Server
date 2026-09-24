import { Router } from "express";
import { ProfileController } from "./profileController";
import { authenticate, requireAdmin } from "../middleware/auth";
import { reenterTenant } from "../middleware/tenant";

const router: Router = Router();
router.get('/me', authenticate, ProfileController.handleGetMyProfile);
router.post('/me', authenticate, reenterTenant, ProfileController.upsertMyProfile);
router.post('/me/password', authenticate, ProfileController.handleChangeMyPassword);
router.post('/:userId', authenticate, reenterTenant, ProfileController.create);
router.get('/:userId', authenticate, ProfileController.handleGetProfile);
router.delete('/:userId', authenticate, requireAdmin, ProfileController.handleDeleteProfile);
router.delete('/user/:id', authenticate, requireAdmin, ProfileController.handleDeleteUser);
router.post('/change-password/:id', authenticate, requireAdmin, ProfileController.handleUpdatePassword);
router.post('/update-email/:id', authenticate, requireAdmin, ProfileController.handleUpdateEmail);

export default router;
