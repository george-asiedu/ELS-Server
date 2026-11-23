import { Router } from "express";
import { authenticate, requireAdmin } from "../middleware/auth";
import { getTenantContext } from "../tenant/context";
import { ApiError } from "../middleware/apiError";
import { SalesService } from "./salesService";

const router: Router = Router();
const service = new SalesService();
const studio = () => {
  const id = getTenantContext()?.studioId;
  if (!id) throw new ApiError("Open your own site to manage sales", 400);
  return id;
};

// Scheduled sales: Black Friday and the like.
router.get("/", authenticate, requireAdmin, async (_req, res) =>
  res.status(200).json(await service.list()),
);
router.post("/", authenticate, requireAdmin, async (req, res) =>
  res.status(201).json(await service.create(studio(), req.body ?? {})),
);
router.patch("/:id", authenticate, requireAdmin, async (req, res) =>
  res
    .status(200)
    .json(
      await service.update(studio(), String(req.params.id), req.body ?? {}),
    ),
);
router.delete("/:id", authenticate, requireAdmin, async (req, res) =>
  res.status(200).json(await service.remove(studio(), String(req.params.id))),
);

export default router;
