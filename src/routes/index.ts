import { Router } from "express";
import authRoutes from "../auth/routes";
import profileRoutes from "../profile/routes";

const router: Router = Router();

router.use("/auth", authRoutes);
router.use("/profile", profileRoutes);

export default router;
