import { Router, Request, Response } from "express";
import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import { authenticate, requireAdmin } from "../middleware/auth";

class CouponService extends Connection {
  public list() {
    return this.coupon.findMany({ orderBy: { createdAt: "desc" } });
  }

  private parse(b: Record<string, unknown>) {
    const code = String(b.code ?? "")
      .trim()
      .toUpperCase();
    if (!/^[A-Z0-9-]{3,24}$/.test(code)) {
      throw new ApiError(
        "Use 3-24 letters, numbers or dashes for the code",
        400,
      );
    }
    const type = b.type === "FIXED" ? ("FIXED" as const) : ("PERCENT" as const);
    const value = Number(b.value);
    if (!(value > 0) || (type === "PERCENT" && value > 100)) {
      throw new ApiError(
        type === "PERCENT"
          ? "Enter a percentage from 1 to 100"
          : "Enter an amount above 0",
        400,
      );
    }
    const maxUses = b.maxUses ? Math.floor(Number(b.maxUses)) : null;
    const expiresAt = b.expiresAt ? new Date(String(b.expiresAt)) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new ApiError("Enter a valid end date", 400);
    }
    return {
      code,
      type,
      value,
      minSubtotal: Math.max(0, Number(b.minSubtotal) || 0),
      maxUses: maxUses && maxUses > 0 ? maxUses : null,
      expiresAt,
      active: b.active !== false,
    };
  }

  public async create(body: Record<string, unknown>) {
    const data = this.parse(body);
    if (await this.coupon.findFirst({ where: { code: data.code } })) {
      throw new ApiError("You already have a coupon with that code", 409);
    }
    return this.coupon.create({ data });
  }

  public async setActive(id: string, active: boolean) {
    const done = await this.coupon.updateMany({
      where: { id },
      data: { active },
    });
    if (!done.count) throw new ApiError("Coupon not found", 404);
  }

  public async remove(id: string) {
    await this.coupon.deleteMany({ where: { id } });
  }
}

const coupons = new CouponService();
const router: Router = Router();
router.use(authenticate, requireAdmin);

router.get("/", async (_req: Request, res: Response) =>
  res
    .status(200)
    .json({ message: "Coupons retrieved", data: await coupons.list() }),
);
router.post("/", async (req: Request, res: Response) =>
  res.status(201).json({
    message: "Coupon created",
    data: await coupons.create(req.body ?? {}),
  }),
);
router.patch("/:id", async (req: Request, res: Response) => {
  await coupons.setActive(String(req.params.id), req.body?.active === true);
  return res.status(200).json({ message: "Coupon updated" });
});
router.delete("/:id", async (req: Request, res: Response) => {
  await coupons.remove(String(req.params.id));
  return res.status(200).json({ message: "Coupon deleted" });
});

export default router;
