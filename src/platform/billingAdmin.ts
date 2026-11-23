import { Router, Request, Response } from "express";
import { createTenantClient } from "../tenant/tenantClient";
import { ApiError } from "../middleware/apiError";
import { HttpCode } from "../models/status_codes";
import { AuditService } from "../audit/auditService";
import { isPlan } from "../billing/billingPlans";

// The super admin's billing controls beyond the platform-wide prices:
// one customer's own terms, and promo codes for what owners pay.
const { raw } = createTenantClient();
const audit = new AuditService();
const actor = (req: Request) => ({
  id: req.user.id,
  email: req.user.email,
  role: req.user.role,
});

const optionalNumber = (v: unknown, label: string, max?: number) => {
  if (v === null || v === "" || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || (max !== undefined && n > max)) {
    throw new ApiError(`Enter a valid ${label}`, HttpCode.BAD_REQUEST);
  }
  return Math.round(n * 100) / 100;
};
const optionalDate = (v: unknown, label: string) => {
  if (v === null || v === "" || v === undefined) return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) {
    throw new ApiError(`Enter a valid ${label}`, HttpCode.BAD_REQUEST);
  }
  return d;
};

export const billingAdminRoutes: Router = Router();

/**
 * One studio's billing: its own monthly price, a discount (with an optional
 * end), a note, and — without any charge — its plan, period and paid-until
 * date. Fields left out stay as they are.
 */
billingAdminRoutes.patch(
  "/studios/:id/billing",
  async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const b = req.body ?? {};
    const before = await raw.studio.findUnique({ where: { id } });
    if (!before) throw new ApiError("Studio not found", HttpCode.NOT_FOUND);

    const data: Record<string, unknown> = {};
    if ("customPriceMonthly" in b)
      data.customPriceMonthly = optionalNumber(
        b.customPriceMonthly,
        "monthly price",
      );
    if ("discountPercent" in b)
      data.billingDiscountPercent = optionalNumber(
        b.discountPercent,
        "discount",
        100,
      );
    if ("discountEndsAt" in b)
      data.billingDiscountEndsAt = optionalDate(
        b.discountEndsAt,
        "discount end date",
      );
    if ("note" in b)
      data.billingNote =
        typeof b.note === "string" && b.note.trim()
          ? b.note.trim().slice(0, 500)
          : null;
    if ("plan" in b) {
      if (!isPlan(b.plan))
        throw new ApiError("Invalid plan", HttpCode.BAD_REQUEST);
      data.plan = b.plan;
    }
    if ("cadence" in b) {
      if (!["MONTHLY", "YEARLY"].includes(b.cadence))
        throw new ApiError("Invalid billing period", HttpCode.BAD_REQUEST);
      data.billingCadence = b.cadence;
    }
    if ("currentPeriodEnd" in b) {
      data.currentPeriodEnd = optionalDate(
        b.currentPeriodEnd,
        "paid-until date",
      );
      data.subscriptionStatus = "active";
    }

    await raw.studio.update({ where: { id }, data });
    await audit.record({
      actor: actor(req),
      action: "platform.studio_billing.updated",
      targetType: "Studio",
      targetId: id,
      studioId: id,
      metadata: { changes: data },
    });
    return res.status(200).json({ message: "Billing updated" });
  },
);

const parsePromo = (b: Record<string, unknown>) => {
  const code = String(b.code ?? "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z0-9-]{3,24}$/.test(code)) {
    throw new ApiError(
      "Use 3-24 letters, numbers or dashes for the code",
      HttpCode.BAD_REQUEST,
    );
  }
  const percentOff = Number(b.percentOff);
  if (!(percentOff > 0 && percentOff <= 100)) {
    throw new ApiError(
      "Enter a percentage from 1 to 100",
      HttpCode.BAD_REQUEST,
    );
  }
  const plans = Array.isArray(b.plans) ? b.plans.filter(isPlan) : [];
  const maxUses = b.maxUses ? Math.floor(Number(b.maxUses)) : null;
  return {
    code,
    percentOff,
    plans,
    maxUses: maxUses && maxUses > 0 ? maxUses : null,
    expiresAt: optionalDate(b.expiresAt, "end date"),
    active: b.active !== false,
  };
};

billingAdminRoutes.get(
  "/billing-promos",
  async (_req: Request, res: Response) => {
    const data = await raw.billingPromo.findMany({
      orderBy: { createdAt: "desc" },
    });
    return res.status(200).json({ message: "Promos", data });
  },
);

billingAdminRoutes.post(
  "/billing-promos",
  async (req: Request, res: Response) => {
    const data = parsePromo(req.body ?? {});
    if (await raw.billingPromo.findUnique({ where: { code: data.code } })) {
      throw new ApiError(
        "A promo with that code already exists",
        HttpCode.CONFLICT,
      );
    }
    const promo = await raw.billingPromo.create({ data });
    await audit.record({
      actor: actor(req),
      action: "platform.billing_promo.created",
      targetType: "BillingPromo",
      targetId: promo.id,
      metadata: data,
    });
    return res.status(201).json({ message: "Promo created", data: promo });
  },
);

billingAdminRoutes.patch(
  "/billing-promos/:id",
  async (req: Request, res: Response) => {
    const done = await raw.billingPromo.updateMany({
      where: { id: String(req.params.id) },
      data: { active: req.body?.active === true },
    });
    if (!done.count) throw new ApiError("Promo not found", HttpCode.NOT_FOUND);
    return res.status(200).json({ message: "Promo updated" });
  },
);

billingAdminRoutes.delete(
  "/billing-promos/:id",
  async (req: Request, res: Response) => {
    await raw.billingPromo.deleteMany({ where: { id: String(req.params.id) } });
    await audit.record({
      actor: actor(req),
      action: "platform.billing_promo.deleted",
      targetType: "BillingPromo",
      targetId: String(req.params.id),
    });
    return res.status(200).json({ message: "Promo deleted" });
  },
);
