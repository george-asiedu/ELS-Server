// What a shop can sell. Picked at signup (Zuri Stores, or Premium's
// shop) and used to choose the shop website's template and starter content.
// The ids are stored; labels are for display.
export const SHOP_CATEGORIES = [
  { id: "clothing", label: "Clothing & fashion" },
  { id: "shoes", label: "Shoes" },
  { id: "bags-accessories", label: "Bags & accessories" },
  { id: "jewellery", label: "Jewellery & watches" },
  { id: "beauty", label: "Beauty & skincare" },
  { id: "hair", label: "Hair & wigs" },
  { id: "perfume", label: "Perfume & fragrance" },
  { id: "food", label: "Food & groceries" },
  { id: "farm", label: "Farm & produce" },
  { id: "drinks", label: "Drinks" },
  { id: "bakery", label: "Cakes & pastries" },
  { id: "electronics", label: "Electronics & gadgets" },
  { id: "phones", label: "Phones & accessories" },
  { id: "home", label: "Home & living" },
  { id: "kids", label: "Kids & baby" },
  { id: "health", label: "Health & wellness" },
  { id: "sports", label: "Sports & fitness" },
  { id: "books", label: "Books & stationery" },
  { id: "art", label: "Art & crafts" },
  { id: "other", label: "Something else" },
] as const;

export type ShopCategory = (typeof SHOP_CATEGORIES)[number]["id"];

export const isShopCategory = (v: unknown): v is ShopCategory =>
  SHOP_CATEGORIES.some((c) => c.id === v);

/** Most kinds a shop can list; keeps the marketplace listing honest. */
export const MAX_SHOP_CATEGORIES = 6;

/**
 * The categories a shop chose, valid and without repeats, in the order picked.
 * Accepts a list (shopCategories) and/or the older single value; the first is
 * the main one, which picks the website design.
 */
export const parseShopCategories = (
  list: unknown,
  single?: unknown,
): ShopCategory[] => {
  const raw = [
    ...(Array.isArray(list) ? list : []),
    ...(single !== undefined && single !== null ? [single] : []),
  ];
  const out: ShopCategory[] = [];
  for (const c of raw) if (isShopCategory(c) && !out.includes(c)) out.push(c);
  return out.slice(0, MAX_SHOP_CATEGORIES);
};
