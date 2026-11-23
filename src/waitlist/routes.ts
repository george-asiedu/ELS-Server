import { Request, Response, Router } from "express";
import { authenticate, optionalAuth, requireAdmin } from "../middleware/auth";
import { WaitlistService } from "./waitlistService";

const service = new WaitlistService();
const router: Router = Router();

// Anyone can join (guests give an email); signed-in customers are linked.
router.post("/", optionalAuth, async (req: Request, res: Response) =>
  res.status(201).json(await service.join(req.body ?? {}, req.user?.id)),
);
router.get(
  "/",
  authenticate,
  requireAdmin,
  async (req: Request, res: Response) =>
    res.status(200).json(await service.forDay(req.query.date)),
);

export default router;
