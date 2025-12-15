import { Router } from "express";
import { AuthController } from "./authController";

const router: Router = Router();

router.post("/signup", AuthController.signup);
router.post("/login", AuthController.login);

export default router;
