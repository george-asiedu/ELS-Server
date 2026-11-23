import { Request, Response, Router } from "express";
import {
  authenticate,
  requireAdmin,
  requireCustomer,
} from "../middleware/auth";
import { CancellationService } from "./cancellationService";

const service = new CancellationService();
const router: Router = Router();

const id = (req: Request) => String(req.params.id);

// Customers: ask to cancel their own booking or paid order.
router.post(
  "/appointments/:id/request",
  authenticate,
  requireCustomer,
  async (req: Request, res: Response) =>
    res
      .status(200)
      .json(
        await service.requestBookingCancel(
          req.user!.id,
          id(req),
          req.body?.reason,
        ),
      ),
);
router.post(
  "/orders/:id/request",
  authenticate,
  requireCustomer,
  async (req: Request, res: Response) =>
    res
      .status(200)
      .json(
        await service.requestOrderCancel(
          req.user!.id,
          id(req),
          req.body?.reason,
        ),
      ),
);

// Admins: approving is the normal "Cancelled" status change; these decline a
// request or record a refund the studio made itself.
router.post(
  "/appointments/:id/decline",
  authenticate,
  requireAdmin,
  async (req: Request, res: Response) =>
    res.status(200).json(await service.declineBookingCancel(id(req))),
);
router.post(
  "/appointments/:id/refunded",
  authenticate,
  requireAdmin,
  async (req: Request, res: Response) =>
    res
      .status(200)
      .json(
        await service.markBookingRefunded(
          id(req),
          req.body?.amount,
          req.body?.note,
        ),
      ),
);
router.post(
  "/orders/:id/decline",
  authenticate,
  requireAdmin,
  async (req: Request, res: Response) =>
    res.status(200).json(await service.declineOrderCancel(id(req))),
);
router.post(
  "/orders/:id/refunded",
  authenticate,
  requireAdmin,
  async (req: Request, res: Response) =>
    res
      .status(200)
      .json(
        await service.markOrderRefunded(
          id(req),
          req.body?.amount,
          req.body?.note,
        ),
      ),
);

export default router;
