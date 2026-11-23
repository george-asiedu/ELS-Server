import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import { createTenantClient } from "../tenant/tenantClient";

// Scheduled sales (Black Friday and the like) for a studio's or store's shop.
//
// A sale is a % off on chosen weekdays between two dates. Rather than teach
// every price on every page about sales, it uses the sale price products
// already have: on a sale day each product with no sale price of its own gets
// one, and the next day it's taken off again. reconcile() sets everything to
// what it should be right now, so running it any number of times is safe.

const { raw } = createTenantClient();
const DAY = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const midnight = (d = new Date()) =>
  new Date(d.toISOString().slice(0, 10) + "T00:00:00.000Z");
const iso = (d: Date) => d.toISOString().slice(0, 10);

type Promo = {
  id: string;
  name: string;
  percentOff: number;
  startsOn: Date;
  endsOn: Date;
  weekdays: number[];
  banner: boolean;
  active: boolean;
};

const isSaleDay = (p: Promo, day: Date) =>
  p.active &&
  p.startsOn <= day &&
  day <= p.endsOn &&
  p.weekdays.includes(day.getUTCDay());

/** The dates this sale runs on, for showing the owner (up to 20). */
export const saleDays = (p: Promo) => {
  const out: string[] = [];
  for (
    let t = p.startsOn.getTime();
    t <= p.endsOn.getTime() && out.length < 20;
    t += DAY
  ) {
    const d = new Date(t);
    if (p.weekdays.includes(d.getUTCDay())) out.push(iso(d));
  }
  return out;
};

const statusOf = (
  p: Promo,
  today: Date,
): "off" | "ended" | "today" | "upcoming" | "between" => {
  if (!p.active) return "off";
  if (p.endsOn < today) return "ended";
  if (isSaleDay(p, today)) return "today";
  return p.startsOn > today || saleDays(p).some((d) => d > iso(today))
    ? p.startsOn > today
      ? "upcoming"
      : "between"
    : "ended";
};

/** Put one studio's product prices and banners where today's sales say they should be. */
export const reconcileStudio = async (studioId: string) => {
  const today = midnight();
  const promos = await raw.salePromo.findMany({ where: { studioId } });
  const live = promos
    .filter((p) => isSaleDay(p, today))
    .sort((a, b) => b.percentOff - a.percentOff);
  const best = live[0];

  if (best) {
    // Products with no price of their own, or already on a sale price.
    const products = await raw.product.findMany({
      where: {
        studioId,
        OR: [
          { salePromoId: null, promoPrice: null },
          { salePromoId: { not: null } },
        ],
      },
      select: { id: true, price: true, promoPrice: true, salePromoId: true },
    });
    for (const pr of products) {
      const target = round2(pr.price * (1 - best.percentOff / 100));
      if (pr.salePromoId !== best.id || pr.promoPrice !== target) {
        await raw.product.update({
          where: { id: pr.id },
          data: { promoPrice: target, salePromoId: best.id },
        });
      }
    }
  } else {
    await raw.product.updateMany({
      where: { studioId, salePromoId: { not: null } },
      data: { promoPrice: null, salePromoId: null },
    });
  }

  // Banners: one per sale, showing only on its sale days.
  const banners = await raw.promoBanner.findMany({
    where: { studioId, salePromoId: { not: null } },
  });
  const byPromo = new Map(banners.map((b) => [b.salePromoId!, b]));
  for (const p of promos) {
    const existing = byPromo.get(p.id);
    const show = p.banner && isSaleDay(p, today);
    const message =
      `${p.name}: ${p.percentOff % 1 ? p.percentOff.toFixed(1) : p.percentOff}% off today`.slice(
        0,
        140,
      );
    if (!existing && p.banner && p.active) {
      await raw.promoBanner.create({
        data: {
          studioId,
          salePromoId: p.id,
          message,
          linkUrl: "/shop",
          placement: "SHOP",
          active: show,
        },
      });
    } else if (
      existing &&
      (existing.active !== show || existing.message !== message)
    ) {
      await raw.promoBanner.update({
        where: { id: existing.id },
        data: { active: show, message },
      });
    }
  }
  const known = new Set(promos.filter((p) => p.banner).map((p) => p.id));
  const orphaned = banners
    .filter((b) => !known.has(b.salePromoId!))
    .map((b) => b.id);
  if (orphaned.length)
    await raw.promoBanner.deleteMany({ where: { id: { in: orphaned } } });
};

/** Hourly, for every studio that has a sale or still has sale prices on. */
export const reconcileAll = async () => {
  const [a, b] = await Promise.all([
    raw.salePromo.findMany({
      distinct: ["studioId"],
      select: { studioId: true },
    }),
    raw.product.findMany({
      where: { salePromoId: { not: null } },
      distinct: ["studioId"],
      select: { studioId: true },
    }),
  ]);
  const ids = [
    ...new Set(
      [...a, ...b].map((r) => r.studioId).filter((x): x is string => !!x),
    ),
  ];
  for (const id of ids)
    await reconcileStudio(id).catch((e) =>
      console.warn("Sale update failed for", id, (e as Error).message),
    );
  return { studios: ids.length };
};

const parseDay = (v: unknown, label: string) => {
  const s = String(v ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s)))
    throw new ApiError(`Choose a valid ${label} date`, 400);
  return new Date(`${s}T00:00:00.000Z`);
};

export class SalesService extends Connection {
  public async list() {
    const today = midnight();
    const promos = await this.salePromo.findMany({
      orderBy: { startsOn: "desc" },
    });
    return {
      message: "Sales",
      data: promos.map((p) => ({
        ...p,
        status: statusOf(p, today),
        days: saleDays(p),
      })),
    };
  }

  private validate(input: Record<string, unknown>) {
    const name = String(input.name ?? "")
      .trim()
      .slice(0, 40);
    if (!name)
      throw new ApiError("Give the sale a name, like Black Friday", 400);
    const percentOff = Number(input.percentOff);
    if (!Number.isFinite(percentOff) || percentOff < 1 || percentOff > 90)
      throw new ApiError("Choose a discount between 1% and 90%", 400);
    const startsOn = parseDay(input.startsOn, "start");
    const endsOn = parseDay(input.endsOn, "end");
    if (endsOn < startsOn)
      throw new ApiError("The end date can't be before the start date", 400);
    if ((endsOn.getTime() - startsOn.getTime()) / DAY > 120)
      throw new ApiError("A sale can run for at most 120 days", 400);
    const weekdays = [
      ...new Set(
        (Array.isArray(input.weekdays) ? input.weekdays : [5]).map(Number),
      ),
    ]
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      .sort();
    if (!weekdays.length)
      throw new ApiError("Choose at least one day of the week", 400);
    return {
      name,
      percentOff: Math.round(percentOff * 10) / 10,
      startsOn,
      endsOn,
      weekdays,
      banner: input.banner !== false,
    };
  }

  public async create(studioId: string, input: Record<string, unknown>) {
    const data = this.validate(input);
    const created = await this.salePromo.create({ data });
    await reconcileStudio(studioId);
    return { message: "Sale scheduled", data: created };
  }

  public async update(
    studioId: string,
    id: string,
    input: Record<string, unknown>,
  ) {
    const existing = await this.salePromo.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Sale not found", 404);
    const data =
      input.name !== undefined ? this.validate({ ...existing, ...input }) : {};
    const updated = await this.salePromo.update({
      where: { id },
      data: {
        ...data,
        ...(input.active !== undefined
          ? { active: Boolean(input.active) }
          : {}),
      },
    });
    await reconcileStudio(studioId);
    return { message: "Sale updated", data: updated };
  }

  public async remove(studioId: string, id: string) {
    const existing = await this.salePromo.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Sale not found", 404);
    await this.salePromo.delete({ where: { id } });
    await reconcileStudio(studioId);
    return { message: "Sale deleted" };
  }
}
