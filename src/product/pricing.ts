// Product prices when options cost different amounts (1 kg, 5 kg, a 20 kg
// crate...). One rule, used wherever a price is worked out, so a cart, an order
// and the shop page can't disagree.

export interface Variant {
  label: string;
  price: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The stored `variants` JSON as a clean list (anything malformed is dropped). */
export const readVariants = (raw: unknown): Variant[] => {
  if (!Array.isArray(raw)) return [];
  const out: Variant[] = [];
  for (const v of raw) {
    if (!v || typeof v !== "object") continue;
    const { label, price } = v as { label?: unknown; price?: unknown };
    if (typeof label === "string" && label.trim() && Number(price) > 0)
      out.push({ label: label.trim(), price: round2(Number(price)) });
  }
  return out;
};

/**
 * What one unit of the product costs for the chosen option. A sale or promo
 * price on the product is a fraction of its (lowest) price, and the same
 * fraction comes off every option, so a 20% sale is 20% off each of them.
 */
export const effectivePriceFor = (
  p: { price: number; promoPrice: number | null; variants?: unknown },
  size?: string | null,
): number => {
  const variant = size
    ? readVariants(p.variants).find((v) => v.label === size)
    : undefined;
  const base = variant?.price ?? p.price;
  if (p.promoPrice != null && p.promoPrice < p.price && p.price > 0)
    return round2((base * p.promoPrice) / p.price);
  return base;
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
    if (!label) return { error: "Every option needs a name" };
    if (!(price > 0) || price > 1_000_000)
      return { error: `Enter a price for "${label}"` };
    if (label.includes("|")) return { error: `"${label}" can't contain |` };
    const key = label.toLowerCase();
    if (seen.has(key)) return { error: `"${label}" is listed twice` };
    seen.add(key);
    variants.push({ label, price });
  }
  return { variants };
};
