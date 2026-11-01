import IORedis from "ioredis";
import { NextFunction, Request, Response } from "express";
import { env } from "../config/env.config";
import { runWithTenant } from "../tenant/context";

// Redis cache for data that's read constantly and changes rarely. Always an
// optimisation: with no Redis, or if it fails, callers read the database.
//
// Never cache payments, stock or free booking slots.
//
// Invalidation is by version number: keys include a version, and bumping it
// makes every older key unreachable (they expire on their own).
let client: IORedis | null = null;
let attempted = false;
const redis = () => {
  if (attempted) return client;
  attempted = true;
  if (!env.redisUrl) return null;
  client = new IORedis(env.redisUrl, {
    maxRetriesPerRequest: 1,
    // Fail fast instead of queueing: the database is the fallback.
    enableOfflineQueue: false,
    commandTimeout: 500,
  });
  client.on("error", (err) =>
    console.error("Redis cache error (reading the database):", err.message),
  );
  return client;
};

const PREFIX = "zuri:cache:";

const version = async (r: IORedis, names: string[]): Promise<string> => {
  const values = await r.mget(names.map((n) => `${PREFIX}ver:${n}`));
  return values.map((v) => v ?? "0").join(".");
};

/** Make everything cached under these version names unreachable. */
export const bumpVersion = async (...names: string[]) => {
  try {
    const r = redis();
    if (!r || !names.length) return;
    const multi = r.multi();
    for (const name of names) multi.incr(`${PREFIX}ver:${name}`);
    await multi.exec();
  } catch (error) {
    console.error("Cache invalidation failed:", (error as Error).message);
  }
};

/** Read through the cache. `versions` are the names that invalidate this key. */
export const cached = async <T>(
  key: string,
  ttlSeconds: number,
  versions: string[],
  load: () => Promise<T>,
): Promise<T> => {
  const r = redis();
  if (!r) return load();
  let fullKey: string;
  try {
    fullKey = `${PREFIX}${await version(r, versions)}:${key}`;
    const hit = await r.get(fullKey);
    if (hit !== null) return JSON.parse(hit) as T;
  } catch {
    return load();
  }
  const value = await load();
  r.set(fullKey, JSON.stringify(value), "EX", ttlSeconds).catch(
    () => undefined,
  );
  return value;
};

const MAX_CACHED_URL = 200;

// Awaiting Redis can lose the request's tenant context, so restore it. (Not
// middleware/tenant's helper: that import would be circular via the extension.)
const resume = (req: Request, next: NextFunction) =>
  runWithTenant(
    req.tenantContext ?? { studioId: req.studioId ?? null, superAdmin: false },
    () => next(),
  );

/**
 * Cache a public GET route's JSON reply, per studio and URL. Writes to the
 * models listed in the tenant extension bump the version; the short TTL covers
 * writes made outside it.
 */
export const cachePublic =
  (ttlSeconds = 120) =>
  async (req: Request, res: Response, next: NextFunction) => {
    const r = redis();
    if (!r || req.originalUrl.length > MAX_CACHED_URL) return next();
    const studio = req.studioId ?? "platform";
    let key: string;
    try {
      const v = await version(r, ["all", `studio:${studio}`]);
      key = `${PREFIX}${v}:http:${studio}:${req.originalUrl}`;
      const hit = await r.get(key);
      if (hit !== null) {
        res.set("X-Cache", "HIT").type("application/json").send(hit);
        return;
      }
    } catch {
      return resume(req, next);
    }
    const json = res.json.bind(res);
    res.json = (body: unknown) => {
      if (res.statusCode === 200) {
        r.set(key, JSON.stringify(body), "EX", ttlSeconds).catch(
          () => undefined,
        );
      }
      return json(body);
    };
    return resume(req, next);
  };
