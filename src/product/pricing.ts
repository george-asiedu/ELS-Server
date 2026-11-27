// Product prices when options cost different amounts (1 kg, 5 kg, a 20 kg
// crate...). One rule, used wherever a price is worked out, so a cart, an order
// and the shop page can't disagree.

export interface Variant {
  label: string;
  price: number;
  /** How many of this option are in stock. Set on every option, or on none. */
  stock?: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The stored `variants` JSON as a clean list (anything malformed is dropped). */
export const readVariants = (raw: unknown): Variant[] => {
  if (!Array.isArray(raw)) return [];
  const out: Variant[] = [];
  for (const v of raw) {
    if (!v || typeof v !== "object") continue;
    const { label, price, stock } = v as {
      label?: unknown;
      price?: unknown;
      stock?: unknown;
    };
    if (typeof label === "string" && label.trim() && Number(price) > 0)
      out.push({
        label: label.trim(),
        price: round2(Number(price)),
        ...(stock !== undefined && stock !== null && Number(stock) >= 0
          ? { stock: Math.floor(Number(stock)) }
          : {}),
      });
  }
  return out;
};

/**
 * What one unit of the product costs for the chosen option. A sale or promo
 * price on the product is a fraction of its (lowest) price, and the same
 * fraction comes off every option, so a 20% sale is 20% off each of them.
 */
export const effectivePriceFor = (
  p: {
    price: number;
    promoPrice: number | null;
    variants?: unknown;
    bulkTiers?: unknown;
  },
  size?: string | null,
  qty?: number,
): number => {
  const variant = size
    ? readVariants(p.variants).find((v) => v.label === size)
    : undefined;
  const base = variant?.price ?? p.price;
  let price = base;
  if (p.promoPrice != null && p.promoPrice < p.price && p.price > 0)
    price = round2((base * p.promoPrice) / p.price);
  // Buying enough of it: the bulk price, unless a sale is already cheaper.
  const off = qty ? tierPercent(p.bulkTiers, qty) : 0;
  if (off > 0) price = Math.min(price, round2(base * (1 - off / 100)));
  return price;
};

/** Validated variants from an owner's input, or an error message. */
export const cleanVariants = (
  raw: unknown,
): { variants: Variant[] } | { error: string } => {
  if (!Array.isArray(raw)) return { error: "Options need a name and a price" };
  const seen = new Set<string>();
  const variants: Variant[] = [];
  for (const v of raw.slice(0, 30)) {
    const label =
      typeof v?.label === "string" ? v.label.trim().slice(0, 40) : "";
    const price = round2(Number(v?.price));
    const hasStock =
      v?.stock !== undefined && v?.stock !== null && v?.stock !== "";
    const stock = hasStock ? Math.floor(Number(v.stock)) : undefined;
    if (hasStock && !(stock! >= 0 && stock! <= 1_000_000))
      return { error: `Enter how many "${label}" are in stock` };
    if (!label) return { error: "Every option needs a name" };
    if (!(price > 0) || price > 1_000_000)
      return { error: `Enter a price for "${label}"` };
    if (label.includes("|")) return { error: `"${label}" can't contain |` };
    const key = label.toLowerCase();
    if (seen.has(key)) return { error: `"${label}" is listed twice` };
    seen.add(key);
    variants.push({ label, price, ...(stock !== undefined ? { stock } : {}) });
  }
  // Stock is set on every option or on none: a half-counted product can't be sold safely.
  if (
    variants.some((v) => v.stock !== undefined) &&
    variants.some((v) => v.stock === undefined)
  )
    return { error: "Give every option a stock number, or none of them" };
  return { variants };
};

// ---- Bulk prices ---------------------------------------------------------

export interface BulkTier {
  minQty: number;
  percentOff: number;
}

/** The stored `bulkTiers` JSON as a clean list, largest quantity first. */
export const readTiers = (raw: unknown): BulkTier[] => {
  if (!Array.isArray(raw)) return [];
  const out: BulkTier[] = [];
  for (const t of raw) {
    const { minQty, percentOff } = (t ?? {}) as {
      minQty?: unknown;
      percentOff?: unknown;
    };
    if (
      Number(minQty) >= 2 &&
      Number(percentOff) > 0 &&
      Number(percentOff) < 100
    )
      out.push({
        minQty: Math.floor(Number(minQty)),
        percentOff: Number(percentOff),
      });
  }
  return out.sort((a, b) => b.minQty - a.minQty);
};

/** The percentage off for buying `qty` of the product (0 when no tier fits). */
export const tierPercent = (raw: unknown, qty: number): number =>
  readTiers(raw).find((t) => qty >= t.minQty)?.percentOff ?? 0;

/** Validated bulk tiers from an owner's input, or an error message. */
export const cleanTiers = (
  raw: unknown,
): { tiers: BulkTier[] } | { error: string } => {
  if (!Array.isArray(raw))
    return { error: "Bulk prices need a quantity and a discount" };
  const seen = new Set<number>();
  const tiers: BulkTier[] = [];
  for (const t of raw.slice(0, 6)) {
    const minQty = Math.floor(Number(t?.minQty));
    const percentOff = Math.round(Number(t?.percentOff) * 10) / 10;
    if (!(minQty >= 2) || minQty > 100000)
      return { error: "A bulk price starts from 2 or more" };
    if (!(percentOff > 0) || percentOff > 90)
      return { error: "A bulk discount is between 1% and 90%" };
    if (seen.has(minQty)) return { error: `${minQty}+ is listed twice` };
    seen.add(minQty);
    tiers.push({ minQty, percentOff });
  }
  return { tiers: tiers.sort((a, b) => a.minQty - b.minQty) };
};

// ---- Stock per option ------------------------------------------------------

/** True when each option of the product counts its own stock. */
export const usesOptionStock = (p: {
  trackStock: boolean;
  variants?: unknown;
}): boolean => {
  const v = readVariants(p.variants);
  return p.trackStock && v.length > 0 && v.every((x) => x.stock !== undefined);
};

/** How many can be bought: the chosen option's own stock, or the product's. */
export const stockFor = (
  p: { trackStock: boolean; stock: number; variants?: unknown },
  size?: string | null,
): number => {
  if (!usesOptionStock(p)) return p.stock;
  const v = readVariants(p.variants).find((x) => x.label === size);
  return v?.stock ?? 0;
};
