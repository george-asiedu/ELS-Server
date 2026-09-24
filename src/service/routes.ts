import { Router } from "express";
import { ServiceController } from "./serviceController";
import { authenticate, requireAdmin } from "../middleware/auth";
import { reenterTenant } from "../middleware/tenant";

const router: Router = Router();

// Public
router.get("/", ServiceController.list);

// Admin
router.get("/all", authenticate, requireAdmin, ServiceController.listAll);
router.post("/", authenticate, requireAdmin, reenterTenant, ServiceController.create);
router.put("/:id", authenticate, requireAdmin, reenterTenant, ServiceController.update);
router.delete("/:id", authenticate, requireAdmin, ServiceController.remove);

// Public single (kept after /all so it doesn't shadow it)
router.get("/:id", ServiceController.getOne);

export default router;
