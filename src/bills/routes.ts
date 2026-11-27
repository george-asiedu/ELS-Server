import { Router } from "express";
import { parseCursorPage } from "../utils/cursorPagination";
import { authenticate, requireAdmin } from "../middleware/auth";
import { BillService } from "./billService";
import { ApiError } from "../middleware/apiError";
import { requireCaptcha } from "../middleware/captcha";

const router: Router = Router();
const bills = new BillService();

// Public: the customer's pay page. The secret token in the link is the key.
router.get("/pay/:token", async (req, res) =>
  res.status(200).json(await bills.publicView(String(req.params.token))),
);
router.post("/pay/:token/start", requireCaptcha, async (req, res) =>
  res
    .status(200)
    .json(
      await bills.startPayment(
        String(req.params.token),
        req.body?.email,
        req.headers.origin,
      ),
    ),
);
router.post("/pay/:token/momo", requireCaptcha, async (req, res) => {
  const { phone, provider, email } = req.body ?? {};
  if (!phone || !provider)
    throw new ApiError("phone and provider are required", 400);
  return res
    .status(200)
    .json(
      await bills.chargeMomo(
        String(req.params.token),
        email,
        String(phone).trim(),
        String(provider).trim().toLowerCase(),
      ),
    );
});
router.get("/pay/:token/verify", async (req, res) =>
  res
    .status(200)
    .json(
      await bills.verifyPayment(
        String(req.params.token),
        String(req.query.reference ?? ""),
      ),
    ),
);

// Studio admin: create, list, cancel, or record a payment taken at the counter.
router.post("/", authenticate, requireAdmin, async (req, res) =>
  res.status(201).json(await bills.create(req.body ?? {}, req.user!.id)),
);
router.get("/", authenticate, requireAdmin, async (req, res) =>
  res
    .status(200)
    .json(
      await bills.list(
        typeof req.query.status === "string" ? req.query.status : undefined,
        parseCursorPage(req.query.cursor, req.query.limit, 25),
      ),
    ),
);
router.post("/:id/void", authenticate, requireAdmin, async (req, res) =>
  res.status(200).json(await bills.void(String(req.params.id))),
);
router.post("/:id/paid", authenticate, requireAdmin, async (req, res) =>
  res
    .status(200)
    .json(
      await bills.markPaidOffline(
        String(req.params.id),
        req.body?.method,
        req.body?.note,
        req.body?.received,
      ),
    ),
);
router.post("/:id/remind", authenticate, requireAdmin, async (req, res) =>
  res.status(200).json(await bills.remind(String(req.params.id))),
);

export default router;
