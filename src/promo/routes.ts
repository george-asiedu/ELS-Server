import { Router } from "express";
import { PromoController } from "./promoController";
import { authenticate, requireAdmin } from "../middleware/auth";

const router: Router = Router();

// Public — storefront reads active banners for a placement.
router.get("/", PromoController.list);

// Admin — manage this studio's banners.
router.get("/all", authenticate, requireAdmin, PromoController.listAll);
router.post("/", authenticate, requireAdmin, PromoController.create);
router.put("/:id", authenticate, requireAdmin, PromoController.update);
router.delete("/:id", authenticate, requireAdmin, PromoController.remove);

export default router;
