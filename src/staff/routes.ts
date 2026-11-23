import { Request, Response, Router } from "express";
import { authenticate, requireAdmin } from "../middleware/auth";
import { ApiError } from "../middleware/apiError";
import { createTenantClient } from "../tenant/tenantClient";
import { S3BucketService } from "../bucket/s3BucketService";

// Staff (stylists, chairs). Customers see the active ones on the booking page;
// admins manage them. Bookings can be made with a particular person.

const { db } = createTenantClient();
const s3 = new S3BucketService();
const router: Router = Router();

const present = <T extends { photoUrl: string | null }>(s: T) => ({
  ...s,
  photoUrl: s.photoUrl ? (s3.deliveryUrl(s.photoUrl) ?? s.photoUrl) : null,
});

/** Validated fields from a create/update body. */
const fields = async (body: Record<string, unknown>, partial: boolean) => {
  const out: Record<string, unknown> = {};
  if (body.name !== undefined || !partial) {
    const name =
      typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
    if (!name) throw new ApiError("Enter a name", 400);
    out.name = name;
  }
  if (body.role !== undefined)
    out.role =
      typeof body.role === "string" && body.role.trim()
        ? body.role.trim().slice(0, 60)
        : null;
  if (body.active !== undefined)
    out.active = body.active === true || body.active === "true";
  if (body.order !== undefined && Number.isFinite(Number(body.order)))
    out.order = Math.trunc(Number(body.order));
  if (body.serviceIds !== undefined) {
    const ids = Array.isArray(body.serviceIds)
      ? (body.serviceIds as unknown[]).filter(
          (x): x is string => typeof x === "string",
        )
      : [];
    // Only this studio's services.
    const known = await db.service.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    out.serviceIds = known.map((s) => s.id);
  }
  if (body.photoUrl !== undefined)
    out.photoUrl =
      typeof body.photoUrl === "string" && body.photoUrl
        ? s3.assertOwnedMediaUrl(body.photoUrl, "staff")
        : null;
  return out;
};

// Public: who can be booked.
router.get("/", async (_req: Request, res: Response) => {
  const staff = await db.staff.findMany({
    where: { active: true },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      role: true,
      photoUrl: true,
      serviceIds: true,
    },
  });
  return res.status(200).json({ data: staff.map(present) });
});

// Admin.
router.get(
  "/all",
  authenticate,
  requireAdmin,
  async (_req: Request, res: Response) => {
    const staff = await db.staff.findMany({
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });
    return res.status(200).json({ data: staff.map(present) });
  },
);

router.post(
  "/",
  authenticate,
  requireAdmin,
  async (req: Request, res: Response) => {
    const data = (await fields(req.body ?? {}, false)) as { name: string };
    const created = await db.staff.create({ data });
    return res
      .status(201)
      .json({ message: "Staff member added", data: present(created) });
  },
);

router.put(
  "/:id",
  authenticate,
  requireAdmin,
  async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!(await db.staff.findUnique({ where: { id } })))
      throw new ApiError("Staff member not found", 404);
    const updated = await db.staff.update({
      where: { id },
      data: await fields(req.body ?? {}, true),
    });
    return res.status(200).json({ message: "Saved", data: present(updated) });
  },
);

// Their past bookings stay, just without a name attached.
router.delete(
  "/:id",
  authenticate,
  requireAdmin,
  async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!(await db.staff.findUnique({ where: { id } })))
      throw new ApiError("Staff member not found", 404);
    await db.staff.delete({ where: { id } });
    return res.status(200).json({ message: "Staff member removed" });
  },
);

export default router;
