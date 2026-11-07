import { Router } from "express";
import { OnboardingController } from "./onboardingController";

const router: Router = Router();

// Public, payment-gated self-serve studio signup.
router.get("/config", OnboardingController.config);
router.get("/availability", OnboardingController.availability);
router.post("/email-code", OnboardingController.sendEmailCode);
router.post("/email-code/confirm", OnboardingController.confirmEmailCode);
router.get("/promo", OnboardingController.checkPromo);
router.post("/start", OnboardingController.start);
router.get("/status", OnboardingController.status);

export default router;
