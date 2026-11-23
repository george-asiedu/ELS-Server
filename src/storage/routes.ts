import { Router } from "express";
import { authenticate, requireAdmin } from "../middleware/auth";
import { getTenantContext } from "../tenant/context";
import { ApiError } from "../middleware/apiError";
import { addBlock, removeBlock, storageSummary } from "./storageService";

const router: Router = Router();
const studio = () => {
  const id = getTenantContext()?.studioId;
  if (!id) throw new ApiError("Open your studio's own site to see storage", 400);
  return id;
};

// What the studio has stored, its limit, and the extra blocks it has taken.
router.get("/", authenticate, requireAdmin, async (req, res) =>
  res.status(200).json({ data: await storageSummary(studio(), req.query.refresh === "1") }),
);
// Take one more block (billed monthly on the next renewal) or give one back.
router.post("/blocks", authenticate, requireAdmin, async (_req, res) =>
  res.status(200).json({ message: "Extra storage added", data: await addBlock(studio()) }),
);
router.delete("/blocks", authenticate, requireAdmin, async (_req, res) =>
  res.status(200).json({ message: "Extra storage removed from next month", data: await removeBlock(studio()) }),
);

export default router;
