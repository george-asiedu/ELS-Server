import { Request, Response, Router } from "express";
import { parseCursorPage } from "../utils/cursorPagination";
import { authenticate, optionalAuth, requireAdmin } from "../middleware/auth";
import { VoucherService } from "./voucherService";

const service = new VoucherService();
const router: Router = Router();
const origin = (req: Request) => req.get("origin") ?? undefined;

// Public: packages on sale, buying, confirming payment, checking a code.
router.get("/packages", async (_req: Request, res: Response) =>
  res.status(200).json(await service.listOffers(true)),
);
router.post("/gift-card", optionalAuth, async (req: Request, res: Response) =>
  res
    .status(200)
    .json(await service.buyGiftCard(req.body ?? {}, req.user?.id, origin(req))),
);
router.post("/package", optionalAuth, async (req: Request, res: Response) =>
  res
    .status(200)
    .json(await service.buyPackage(req.body ?? {}, req.user?.id, origin(req))),
);
router.get("/verify", async (req: Request, res: Response) =>
  res.status(200).json(await service.verify(String(req.query.reference ?? ""))),
);
router.get("/check", async (req: Request, res: Response) =>
  res
    .status(200)
    .json(await service.check(req.query.code, req.query.serviceId)),
);

// Customers: their own gift cards and packages.
router.get("/mine", authenticate, async (req: Request, res: Response) =>
  res
    .status(200)
    .json(
      await service.mine(
        req.user!.id,
        req.user!.email,
        parseCursorPage(req.query.cursor, req.query.limit),
      ),
    ),
);

// Admin.
router.get(
  "/",
  authenticate,
  requireAdmin,
  async (req: Request, res: Response) =>
    res
      .status(200)
      .json(
        await service.list(parseCursorPage(req.query.cursor, req.query.limit)),
      ),
);
router.post(
  "/:id/redeem",
  authenticate,
  requireAdmin,
  async (req: Request, res: Response) =>
    res
      .status(200)
      .json(
        await service.redeemInPerson(String(req.params.id), req.body?.amount),
      ),
);
router.get(
  "/packages/all",
  authenticate,
  requireAdmin,
  async (_req: Request, res: Response) =>
    res.status(200).json(await service.listOffers(false)),
);
router.post(
  "/packages",
  authenticate,
  requireAdmin,
  async (req: Request, res: Response) =>
    res.status(201).json(await service.saveOffer(null, req.body ?? {})),
);
router.put(
  "/packages/:id",
  authenticate,
  requireAdmin,
  async (req: Request, res: Response) =>
    res
      .status(200)
      .json(await service.saveOffer(String(req.params.id), req.body ?? {})),
);
router.delete(
  "/packages/:id",
  authenticate,
  requireAdmin,
  async (req: Request, res: Response) =>
    res.status(200).json(await service.removeOffer(String(req.params.id))),
);

export default router;
