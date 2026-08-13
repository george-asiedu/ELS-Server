import { PrismaClient } from "../generated/prisma-client/client";

// A dedicated raw client for looking up studios (Studio is not a scoped model,
// so it needs no tenant context). Small in-memory cache keeps this off the hot
// path — a slug is resolved to a studio at most once per TTL window.
const client = new PrismaClient({} as never);

export interface ResolvedStudio {
  id: string;
  slug: string;
  status: "ACTIVE" | "SUSPENDED" | "TRIAL";
}

const TTL_MS = 60_000;
const cache = new Map<string, { value: ResolvedStudio | null; at: number }>();

export const resolveStudioBySlug = async (
  slug: string,
): Promise<ResolvedStudio | null> => {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const studio = await client.studio.findUnique({
    where: { slug },
    select: { id: true, slug: true, status: true },
  });

  const value = (studio as ResolvedStudio | null) ?? null;
  // Only cache hits — caching a miss would keep a just-provisioned studio
  // unreachable until the TTL expired.
  if (value) cache.set(slug, { value, at: Date.now() });
  return value;
};

// Invalidate a cached slug (e.g. after a studio is renamed or suspended).
export const forgetStudioSlug = (slug: string) => cache.delete(slug);
