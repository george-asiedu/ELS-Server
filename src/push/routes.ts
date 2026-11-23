import { Request, Response, Router } from "express";
import { authenticate } from "../middleware/auth";
import { ApiError } from "../middleware/apiError";
import { HttpCode } from "../models/status_codes";
import { env } from "../config/env.config";
import { createTenantClient } from "../tenant/tenantClient";
import { pushConfigured, pushToUsers } from "./pushService";

const { raw } = createTenantClient();
const router: Router = Router();

const MAX_DEVICES = 10;

/** The key a browser needs to subscribe, and how many devices are on. */
router.get("/", authenticate, async (req: Request, res: Response) => {
  const devices = await raw.pushSubscription.count({
    where: { userId: req.user!.id },
  });
  return res
    .status(200)
    .json({ publicKey: pushConfigured ? env.vapid.publicKey : null, devices });
});

router.post(
  "/subscriptions",
  authenticate,
  async (req: Request, res: Response) => {
    if (!pushConfigured)
      throw new ApiError(
        "Notifications aren't set up on the server yet",
        HttpCode.BAD_REQUEST,
      );
    const { endpoint, keys } = req.body ?? {};
    // Push services are always https; never let a subscription point elsewhere.
    if (
      typeof endpoint !== "string" ||
      !endpoint.startsWith("https://") ||
      endpoint.length > 1000 ||
      typeof keys?.p256dh !== "string" ||
      typeof keys?.auth !== "string" ||
      keys.p256dh.length > 200 ||
      keys.auth.length > 100
    )
      throw new ApiError("That subscription isn't valid", HttpCode.BAD_REQUEST);
    const userAgent =
      String(req.headers["user-agent"] ?? "").slice(0, 300) || null;
    // An endpoint is one browser: if someone else signs in there, it moves to them.
    await raw.pushSubscription.upsert({
      where: { endpoint },
      create: {
        userId: req.user!.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent,
      },
      update: {
        userId: req.user!.id,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent,
      },
    });
    const extra = await raw.pushSubscription.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: "desc" },
      skip: MAX_DEVICES,
      select: { id: true },
    });
    if (extra.length)
      await raw.pushSubscription.deleteMany({
        where: { id: { in: extra.map((e) => e.id) } },
      });
    return res.status(204).end();
  },
);

router.delete(
  "/subscriptions",
  authenticate,
  async (req: Request, res: Response) => {
    const endpoint = req.body?.endpoint;
    if (typeof endpoint === "string")
      await raw.pushSubscription.deleteMany({
        where: { userId: req.user!.id, endpoint },
      });
    return res.status(204).end();
  },
);

router.post("/test", authenticate, async (req: Request, res: Response) => {
  const result = await pushToUsers([req.user!.id], {
    title: "Notifications are working",
    body: "You'll get updates like this on this device.",
    url: "/",
    tag: "test",
  });
  if (!result.sent)
    throw new ApiError(
      "Turn on notifications on this device first",
      HttpCode.BAD_REQUEST,
    );
  return res.status(202).json({ devices: result.sent });
});

export default router;
