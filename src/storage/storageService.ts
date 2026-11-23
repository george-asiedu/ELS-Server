import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { env } from "../config/env.config";
import { ApiError } from "../middleware/apiError";
import { createTenantClient } from "../tenant/tenantClient";
import { addExtraCharge } from "../billing/extraCharges";

// Storage for Zuri Studios plans (Zuri Stores has none of this). What a studio
// uses is read from its files in the bucket, so every upload counts and nothing
// has to be kept in step. Deleted gallery items stay in a 30-day trash that
// still counts; past the limit uploads stop until files are removed or the
// studio takes extra blocks (billed monthly on its next renewal).

const { raw } = createTenantClient();
const MB = 1024 * 1024;
export const TRASH_DAYS = 30;

let client: S3Client | null = null;
const s3 = () =>
  (client ??= new S3Client({
    region: env.aws.region,
    credentials: {
      accessKeyId: env.aws.accessKeyId,
      secretAccessKey: env.aws.secretAccessKey,
    },
  }));

type Listing = {
  at: number;
  total: number;
  byCategory: Record<string, number>;
  sizes: Map<string, number>;
};
const cache = new Map<string, Listing>();

/** Everything stored under the studio's folder, summed. Cached for a few minutes. */
const listing = async (studioId: string, force = false): Promise<Listing> => {
  const hit = cache.get(studioId);
  if (hit && !force && Date.now() - hit.at < 5 * 60_000) return hit;
  const prefix = `studios/${studioId}/`;
  const sizes = new Map<string, number>();
  const byCategory: Record<string, number> = {};
  let total = 0;
  let token: string | undefined;
  do {
    const page = await s3().send(
      new ListObjectsV2Command({
        Bucket: env.aws.s3BucketName,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const o of page.Contents ?? []) {
      const size = o.Size ?? 0;
      sizes.set(o.Key!, size);
      total += size;
      const category = o.Key!.slice(prefix.length).split("/")[0] || "other";
      byCategory[category] = (byCategory[category] ?? 0) + size;
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  const fresh = { at: Date.now(), total, byCategory, sizes };
  cache.set(studioId, fresh);
  return fresh;
};

/** After an upload or delete, so the next check is right without waiting. */
export const forgetStorage = (studioId: string) => cache.delete(studioId);

/** The storage key behind a media URL (CloudFront or S3 address). */
export const keyFromUrl = (url: string): string | null => {
  try {
    const key = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
    return key.startsWith("studios/") ? key : null;
  } catch {
    return null;
  }
};

const config = async () =>
  (await raw.platformConfig.findFirst()) ??
  (await raw.platformConfig.create({ data: {} }));

const limitsFor = async (studioId: string) => {
  const [studio, cfg] = await Promise.all([
    raw.studio.findUnique({
      where: { id: studioId },
      select: { plan: true, storageExtraBlocks: true },
    }),
    config(),
  ]);
  if (!studio) throw new ApiError("Studio not found", 404);
  const applies = studio.plan !== "STOREFRONT";
  const baseMb =
    studio.plan === "PREMIUM" ? cfg.storagePremiumMb : cfg.storageStandardMb;
  const blocks = studio.storageExtraBlocks;
  return {
    applies,
    plan: studio.plan,
    baseMb,
    blocks,
    blockMb: cfg.storageBlockMb,
    blockPrice: cfg.storageBlockPrice,
    limitBytes: (baseMb + blocks * cfg.storageBlockMb) * MB,
  };
};

/** Refuse an upload that would go past the limit. Zuri Stores accounts are exempt. */
export const assertCanStore = async (
  studioId: string,
  incomingBytes: number,
) => {
  const lim = await limitsFor(studioId);
  if (!lim.applies) return;
  const used = (await listing(studioId)).total;
  if (used + incomingBytes > lim.limitBytes) {
    throw new ApiError(
      `Your storage is full. Delete some files, or add ${lim.blockMb} MB for GHS ${lim.blockPrice.toFixed(2)} a month on the Storage page.`,
      413,
    );
  }
};

export const storageSummary = async (studioId: string, force = false) => {
  const lim = await limitsFor(studioId);
  const l = await listing(studioId, force);
  const trashed = await raw.gallery.findMany({
    where: { studioId, deletedAt: { not: null } },
    select: { imageUrl: true },
  });
  const trashBytes = trashed.reduce(
    (s, g) =>
      s +
      ((keyFromUrl(g.imageUrl) && l.sizes.get(keyFromUrl(g.imageUrl)!)) || 0),
    0,
  );
  return {
    applies: lim.applies,
    plan: lim.plan,
    usedBytes: l.total,
    trashBytes,
    limitBytes: lim.limitBytes,
    includedMb: lim.baseMb,
    extraBlocks: lim.blocks,
    blockMb: lim.blockMb,
    blockPrice: lim.blockPrice,
    extraPerMonth: Math.round(lim.blocks * lim.blockPrice * 100) / 100,
    byCategory: Object.entries(l.byCategory)
      .map(([category, bytes]) => ({ category, bytes }))
      .sort((a, b) => b.bytes - a.bytes),
    trashDays: TRASH_DAYS,
  };
};

const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
const monthLabel = (d = new Date()) =>
  d.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

/** Take one more block now; this month's charge is added to the next renewal. */
export const addBlock = async (studioId: string) => {
  const lim = await limitsFor(studioId);
  if (!lim.applies)
    throw new ApiError("Extra storage is for Zuri Studios plans", 400);
  const updated = await raw.studio.update({
    where: { id: studioId },
    data: { storageExtraBlocks: { increment: 1 } },
    select: { storageExtraBlocks: true },
  });
  await chargeMonth(
    studioId,
    updated.storageExtraBlocks,
    lim.blockMb,
    lim.blockPrice,
  );
  return storageSummary(studioId, true);
};

/** Give a block back (only when what's stored still fits). It stops from next month. */
export const removeBlock = async (studioId: string) => {
  const lim = await limitsFor(studioId);
  if (lim.blocks <= 0)
    throw new ApiError("You haven't added any extra storage", 400);
  const used = (await listing(studioId)).total;
  const newLimit = (lim.baseMb + (lim.blocks - 1) * lim.blockMb) * MB;
  if (used > newLimit)
    throw new ApiError(
      "What you've stored wouldn't fit. Delete some files first.",
      400,
    );
  await raw.studio.update({
    where: { id: studioId },
    data: { storageExtraBlocks: { decrement: 1 } },
  });
  return storageSummary(studioId, true);
};

const chargeMonth = (
  studioId: string,
  blocks: number,
  blockMb: number,
  price: number,
  at = new Date(),
) =>
  addExtraCharge({
    studioId,
    kind: "STORAGE_OVERAGE",
    refId: `storage:${monthKey(at)}`,
    description: `Extra storage, ${blocks} × ${blockMb} MB (${monthLabel(at)})`,
    amount: blocks * price,
  });

/** Run on the 1st: every studio with extra blocks owes for the new month. */
export const billStorageForMonth = async () => {
  const cfg = await config();
  const studios = await raw.studio.findMany({
    where: { storageExtraBlocks: { gt: 0 }, plan: { not: "STOREFRONT" } },
    select: { id: true, storageExtraBlocks: true },
  });
  for (const s of studios)
    await chargeMonth(
      s.id,
      s.storageExtraBlocks,
      cfg.storageBlockMb,
      cfg.storageBlockPrice,
    );
  return { studiosBilled: studios.length };
};

// ---- Super admin: what each plan includes and what an extra block costs.

export const platformStorageSettings = async () => {
  const c = await config();
  return {
    standardMb: c.storageStandardMb,
    premiumMb: c.storagePremiumMb,
    blockMb: c.storageBlockMb,
    blockPrice: c.storageBlockPrice,
  };
};

export const savePlatformStorageSettings = async (
  input: Record<string, unknown>,
) => {
  const whole = (v: unknown, label: string, min: number, max: number) => {
    const n = Math.trunc(Number(v));
    if (!Number.isFinite(n) || n < min || n > max)
      throw new ApiError(`${label} should be between ${min} and ${max}`, 400);
    return n;
  };
  const price = Math.round(Number(input.blockPrice) * 100) / 100;
  if (!Number.isFinite(price) || price < 0 || price > 10000)
    throw new ApiError("The block price should be between 0 and 10,000", 400);
  const c = await config();
  await raw.platformConfig.update({
    where: { id: c.id },
    data: {
      storageStandardMb: whole(
        input.standardMb,
        "Standard storage (MB)",
        50,
        1_000_000,
      ),
      storagePremiumMb: whole(
        input.premiumMb,
        "Premium storage (MB)",
        50,
        1_000_000,
      ),
      storageBlockMb: whole(input.blockMb, "Block size (MB)", 10, 100_000),
      storageBlockPrice: price,
    },
  });
  return platformStorageSettings();
};
