import { Request, Response, Router } from "express";
import { authenticate } from "../middleware/auth";
import { createTenantClient } from "../tenant/tenantClient";

const { raw } = createTenantClient();
const router: Router = Router();

/** The latest notifications, newest first, and how many are unread. */
router.get("/", authenticate, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const [items, unread] = await Promise.all([
    raw.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, title: true, body: true, url: true, readAt: true, createdAt: true },
    }),
    raw.notification.count({ where: { userId, readAt: null } }),
  ]);
  return res.status(200).json({ data: items, unread });
});

/** Mark some (ids) or all of them read. */
router.post("/read", authenticate, async (req: Request, res: Response) => {
  const ids = Array.isArray(req.body?.ids)
    ? (req.body.ids as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 100)
    : null;
  await raw.notification.updateMany({
    where: { userId: req.user!.id, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
  return res.status(204).end();
});

export default router;
