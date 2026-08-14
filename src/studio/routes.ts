import { Router } from "express";
import { StudioController } from "./studioController";

const router: Router = Router();

// Public: the current studio's branding/content/feature config for the SPA.
router.get("/", StudioController.config);

export default router;
