// Kinds of studio (they pick the website's default wording and look).
// Mirrored by the frontend's lib/studioTemplates.ts.
export const STUDIO_TYPES = [
  "hair",
  "braids",
  "nails",
  "lashes-brows",
  "makeup",
  "skin-spa",
  "barber",
  "wellness",
  "general",
] as const;
export type StudioType = (typeof STUDIO_TYPES)[number];

export const isStudioType = (v: unknown): v is StudioType =>
  typeof v === "string" && (STUDIO_TYPES as readonly string[]).includes(v);

/** Most kinds a studio can pick (the same limit as a shop's categories). */
export const MAX_STUDIO_TYPES = 6;

/**
 * The kinds a studio picked, valid and without repeats, in the order picked.
 * A studio can do several (hair, nails, lashes...). The first is the main one,
 * which picks the website's wording and look.
 */
export const parseStudioTypes = (
  list: unknown,
  single?: unknown,
): StudioType[] => {
  const raw = [
    ...(Array.isArray(list) ? list : []),
    ...(single !== undefined && single !== null ? [single] : []),
  ];
  const out: StudioType[] = [];
  for (const t of raw) if (isStudioType(t) && !out.includes(t)) out.push(t);
  return out.slice(0, MAX_STUDIO_TYPES);
};
