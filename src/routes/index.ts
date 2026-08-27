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
import paymentRoutes from "../payment/routes";
import productRoutes from "../product/routes";
import productCategoryRoutes from "../productCategory/routes";
import cartRoutes from "../cart/routes";
import orderRoutes from "../order/routes";
import commerceRoutes from "../commerce/routes";
import platformRoutes from "../platform/routes";
import studioRoutes from "../studio/routes";
import featureRequestRoutes from "../featureRequest/routes";
import promoRoutes from "../promo/routes";

const router: Router = Router();

// Super-admin surface. resolveTenant runs these in the platform (superAdmin)
// context — no studio scoping — and the routes guard themselves.
router.use("/platform", platformRoutes);

// Public per-studio storefront config (branding/content/feature flags).
router.use("/studio", studioRoutes);

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
router.use("/payments", paymentRoutes);
router.use("/products", productRoutes);
router.use("/product-categories", productCategoryRoutes);
router.use("/cart", cartRoutes);
router.use("/orders", orderRoutes);
router.use("/commerce", commerceRoutes);
router.use("/feature-requests", featureRequestRoutes);
router.use("/promo-banners", promoRoutes);

export default router;
