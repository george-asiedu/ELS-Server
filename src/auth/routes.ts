import { Router } from "express";
import { AuthController } from "./authController";

const router: Router = Router();

router.post("/signup", AuthController.signup);
router.post("/login", AuthController.login);
router.post("/forgot-password", AuthController.forgotPassword);
router.post("/reset-password/:token", AuthController.resetPassword);

export default router;
