import { Router } from "express";
import { authenticate, requireAdmin } from "../middleware/auth";
import { getTenantContext } from "../tenant/context";
import { ApiError } from "../middleware/apiError";
import {
  cancelLiveSpot,
  requestInPerson,
  reserveLiveSpot,
  trainingInfo,
} from "./trainingService";
import { verifyLearnSteps } from "./stepChecks";

const router: Router = Router();
const studio = () => {
  const id = getTenantContext()?.studioId;
  if (!id) throw new ApiError("Open your own site to see training", 400);
  return id;
};

// A studio's view: the free live session and its own in-person requests.
router.get("/", authenticate, requireAdmin, async (_req, res) =>
  res.status(200).json({ data: await trainingInfo(studio()) }),
);
// Which Learn steps the business has really done, proven from its own data.
router.get("/steps", authenticate, requireAdmin, async (_req, res) =>
  res.status(200).json({ data: await verifyLearnSteps(studio()) }),
);
router.post("/requests", authenticate, requireAdmin, async (req, res) =>
  res.status(201).json({
    message: "Request sent. We'll get back to you with a date and the fee.",
    data: await requestInPerson(studio(), req.user?.id, req.body ?? {}),
  }),
);

// Reserve (or give up) a spot at the next free live session.
router.post("/live/reserve", authenticate, requireAdmin, async (req, res) => {
  const result = await reserveLiveSpot(studio(), {
    id: req.user?.id,
    email: req.user?.email,
  });
  res.status(result.already ? 200 : 201).json({
    message: result.already
      ? "You already have a spot"
      : "Spot reserved. We've emailed you a calendar invite.",
    data: { sessionAt: result.at },
  });
});
router.delete(
  "/live/reserve",
  authenticate,
  requireAdmin,
  async (_req, res) => {
    await cancelLiveSpot(studio());
    res.status(200).json({ message: "Your spot was cancelled" });
  },
);

export default router;
