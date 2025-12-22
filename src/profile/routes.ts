import { Router } from "express";
import { ProfileController } from "./profileController";
import multer from "multer";

const router: Router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/:userId', upload.single('image'), ProfileController.create);
router.get('/:userId', ProfileController.handleGetProfile);
router.delete('/:userId', ProfileController.handleDeleteProfile);
router.delete('/user/:id', ProfileController.handleDeleteUser);
router.post('/change-password/:id', ProfileController.handleUpdatePassword);
router.post('/update-email/:id', ProfileController.handleUpdateEmail);

export default router;
