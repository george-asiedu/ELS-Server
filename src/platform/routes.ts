import { Router } from "express";
import { PlatformController } from "./platformController";
import { authenticate, requireSuperAdmin } from "../middleware/auth";

const router: Router = Router();

// Public: super-admin sign-in.
router.post("/auth/login", PlatformController.login);

// Everything below requires a signed-in super admin.
router.use(authenticate, requireSuperAdmin);

router.get("/me", PlatformController.me);

router.get("/studios", PlatformController.listStudios);
router.post("/studios", PlatformController.createStudio);
router.get("/studios/:id", PlatformController.getStudio);
router.patch("/studios/:id", PlatformController.updateStudio);
router.patch("/studios/:id/status", PlatformController.setStatus);
router.patch("/studios/:id/settings", PlatformController.updateSettings);
router.post("/studios/:id/impersonate", PlatformController.impersonate);

export default router;
