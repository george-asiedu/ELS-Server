import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import { HttpCode } from "../models/status_codes";

const PLACEMENTS = ["SHOP", "BOOKING", "BOTH"] as const;
type Placement = (typeof PLACEMENTS)[number];
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const color = (v: unknown, field: string): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const s = String(v).trim();
  if (!HEX_RE.test(s)) {
    throw new ApiError(`${field} must be a hex color`, HttpCode.BAD_REQUEST);
  }
  return s;
};

// PromoBanner is tenant-scoped, so studioId is injected automatically by the
// tenant extension for every query here.
export class PromoService extends Connection {
  // Public: active banners for a placement (shop/booking), plus BOTH.
  public async listActive(placement?: string) {
    const p = (placement ?? "").toUpperCase();
    const where: { active: boolean; placement?: { in: Placement[] } } = {
      active: true,
    };
    if (p === "SHOP" || p === "BOOKING") {
      where.placement = { in: [p as Placement, "BOTH"] };
    }
    const banners = await this.promoBanner.findMany({
      where,
      orderBy: [{ order: "asc" }, { createdAt: "desc" }],
    });
    return { message: "Promo banners", data: banners };
  }

  public async listAll() {
    const banners = await this.promoBanner.findMany({
      orderBy: [{ order: "asc" }, { createdAt: "desc" }],
    });
    return { message: "Promo banners", data: banners };
  }

  private validate(input: Record<string, unknown>, requireMessage: boolean) {
    const data: {
      message?: string;
      linkUrl?: string | null;
      bgColor?: string | null;
      textColor?: string | null;
      placement?: Placement;
      active?: boolean;
      order?: number;
    } = {};

    if (input.message !== undefined || requireMessage) {
      const message = String(input.message ?? "").trim();
      if (message.length < 1 || message.length > 140) {
        throw new ApiError("Message must be 1-140 characters", HttpCode.BAD_REQUEST);
      }
      data.message = message;
    }
    if (input.linkUrl !== undefined) {
      const url = String(input.linkUrl ?? "").trim();
      data.linkUrl = url || null;
    }
    const bg = color(input.bgColor, "bgColor");
    if (bg !== undefined) data.bgColor = bg;
    const tc = color(input.textColor, "textColor");
    if (tc !== undefined) data.textColor = tc;

    if (input.placement !== undefined) {
      const pl = String(input.placement).toUpperCase();
      if (!PLACEMENTS.includes(pl as Placement)) {
        throw new ApiError("Invalid placement", HttpCode.BAD_REQUEST);
      }
      data.placement = pl as Placement;
    }
    if (input.active !== undefined) data.active = Boolean(input.active);
    if (input.order !== undefined) data.order = Number(input.order) || 0;
    return data;
  }

  public async create(input: Record<string, unknown>) {
    const data = this.validate(input, true);
    const created = await this.promoBanner.create({
      data: { message: data.message as string, ...data },
    });
    return { message: "Promo banner created", data: created };
  }

  public async update(id: string, input: Record<string, unknown>) {
    const existing = await this.promoBanner.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Banner not found", HttpCode.NOT_FOUND);
    const data = this.validate(input, false);
    const updated = await this.promoBanner.update({ where: { id }, data });
    return { message: "Promo banner updated", data: updated };
  }

  public async remove(id: string) {
    const existing = await this.promoBanner.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Banner not found", HttpCode.NOT_FOUND);
    await this.promoBanner.delete({ where: { id } });
    return { message: "Promo banner deleted" };
  }
}
