import { Router } from "express";
import authRoutes from "../auth/routes";
import profileRoutes from "../profile/routes";
import serviceRoutes from "../service/routes";
import appointmentRoutes from "../appointment/routes";
import accountRoutes from "../account/routes";
import reviewRoutes from "../review/routes";
import galleryRoutes from "../gallery/routes";
import businessHoursRoutes from "../businessHours/routes";
import contactRoutes from "../contact/routes";
import categoryRoutes from "../category/routes";

const router: Router = Router();

router.use("/auth", authRoutes);
router.use("/profile", profileRoutes);
router.use("/categories", categoryRoutes);
router.use("/services", serviceRoutes);
router.use("/appointments", appointmentRoutes);
router.use("/account", accountRoutes);
router.use("/reviews", reviewRoutes);
router.use("/gallery", galleryRoutes);
router.use("/business-hours", businessHoursRoutes);
router.use("/contact-info", contactRoutes);

export default router;
