import { Router } from "express";
import { OnboardingController } from "./onboardingController";

const router: Router = Router();

// Public, payment-gated self-serve studio signup.
router.get("/config", OnboardingController.config);
router.get("/availability", OnboardingController.availability);
router.post("/start", OnboardingController.start);
router.get("/status", OnboardingController.status);

export default router;
