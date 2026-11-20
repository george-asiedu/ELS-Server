import { Router } from "express";
import { authenticate, requireAdmin } from "../middleware/auth";
import { getTenantContext } from "../tenant/context";
import { ApiError } from "../middleware/apiError";
import { requestInPerson, trainingInfo } from "./trainingService";

const router: Router = Router();
const studio = () => {
  const id = getTenantContext()?.studioId;
  if (!id) throw new ApiError("Open your own site to see training", 400);
  return id;
};

// A studio's view: the free live session and its own in-person requests.
router.get("/", authenticate, requireAdmin, async (_req, res) => res.status(200).json({ data: await trainingInfo(studio()) }));
router.post("/requests", authenticate, requireAdmin, async (req, res) =>
  res.status(201).json({ message: "Request sent. We'll get back to you with a date and the fee.", data: await requestInPerson(studio(), req.user?.id, req.body ?? {}) }),
);

export default router;
