import { Request, Response, Router } from "express";
import { authenticate, requireAdmin } from "../middleware/auth";
import { ApiError } from "../middleware/apiError";
import { createTenantClient } from "../tenant/tenantClient";
import { S3BucketService } from "../bucket/s3BucketService";
import {
  ensureStaffAccount,
  removeStaffAccount,
  syncStaffAccount,
} from "./staffAccount";

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
  if (body.email !== undefined) {
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new ApiError("That email address doesn't look right", 400);
    out.email = email ? email.slice(0, 120) : null;
  }
  if (body.phone !== undefined) {
    const phone =
      typeof body.phone === "string" ? body.phone.trim().slice(0, 30) : "";
    if (phone && !/^[+\d][\d\s()-]{6,}$/.test(phone))
      throw new ApiError("That phone number doesn't look right", 400);
    out.phone = phone || null;
  }
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

// ---- A team member's own view: who they are, and their bookings ------------

/** The staff profile of whoever is signed in (a STAFF account, or an admin who is also on the team). */
const myProfile = async (req: Request) => {
  const user = req.user!;
  if (user.role !== "STAFF" && user.role !== "ADMIN")
    throw new ApiError("This is for team members", 403);
  const staff = await db.staff.findFirst({
    where: { userId: user.id },
    select: { id: true, name: true, role: true, photoUrl: true, active: true },
  });
  if (!staff) throw new ApiError("You don't have a staff profile here", 403);
  if (!staff.active)
    throw new ApiError(
      "Your access has been turned off. Ask your studio.",
      403,
    );
  return staff;
};

router.get("/me", authenticate, async (req: Request, res: Response) => {
  const staff = await myProfile(req);
  return res.status(200).json({ data: present(staff) });
});

// Only their own bookings, and only what they need to do the work: no prices
// or payments, and nothing about other people's bookings.
router.get(
  "/me/bookings",
  authenticate,
  async (req: Request, res: Response) => {
    const staff = await myProfile(req);
    const day = (v: unknown, fallback: Date) => {
      const d =
        typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
          ? new Date(`${v}T00:00:00.000Z`)
          : fallback;
      return Number.isNaN(d.getTime()) ? fallback : d;
    };
    const today = new Date(new Date().setUTCHours(0, 0, 0, 0));
    const from = day(req.query.from, today);
    const to = day(req.query.to, new Date(from.getTime() + 14 * 86_400_000));
    const rows = await db.appointment.findMany({
      where: {
        staffId: staff.id,
        appointmentDate: { gte: from, lte: to },
        status: { in: ["PENDING", "CONFIRMED", "COMPLETED"] },
      },
      orderBy: [{ appointmentDate: "asc" }, { appointmentTime: "asc" }],
      take: 200,
      select: {
        id: true,
        fullName: true,
        phone: true,
        notes: true,
        status: true,
        appointmentDate: true,
        appointmentTime: true,
        service: { select: { name: true, duration: true } },
      },
    });
    return res.status(200).json({ data: rows });
  },
);

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
    const data = (await fields(req.body ?? {}, false)) as {
      name: string;
      email?: string | null;
      phone?: string | null;
    };
    // Each team member gets a sign-in straight away, so both are needed.
    if (!data.email)
      throw new ApiError("Enter their email: it is how they sign in", 400);
    if (!data.phone) throw new ApiError("Enter their phone number", 400);
    const created = await db.staff.create({ data });
    try {
      await ensureStaffAccount(created);
    } catch (error) {
      await db.staff.delete({ where: { id: created.id } });
      throw error;
    }
    const withAccount = await db.staff.findUnique({
      where: { id: created.id },
    });
    return res.status(201).json({
      message:
        "Staff member added. They can set their password the first time they sign in.",
      data: present(withAccount ?? created),
    });
  },
);

router.put(
  "/:id",
  authenticate,
  requireAdmin,
  async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const before = await db.staff.findUnique({ where: { id } });
    if (!before) throw new ApiError("Staff member not found", 404);
    const data = await fields(req.body ?? {}, true);
    // Keep their sign-in in step first, so a clash (an email that already has
    // an account) stops the change before anything is saved.
    await syncStaffAccount(before, {
      ...before,
      ...data,
      active: (data.active as boolean | undefined) ?? before.active,
    } as never);
    const updated = await db.staff.update({ where: { id }, data });
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
    const existing = await db.staff.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Staff member not found", 404);
    await removeStaffAccount(existing);
    await db.staff.delete({ where: { id } });
    return res.status(200).json({ message: "Staff member removed" });
  },
);

export default router;
