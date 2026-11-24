import Redis from "ioredis";
import rateLimit from "express-rate-limit";
import { env } from "../config/env.config";

// Share the application's configured Redis connection while giving each
// limiter an independent key namespace. Without REDIS_URL, express-rate-limit
// uses its built-in in-process store (suitable for local/single-instance use).
const redis = env.redisUrl
  ? new Redis(env.redisUrl, {
      maxRetriesPerRequest: 1,
      // Fail fast when Redis is unreachable instead of queueing commands, and
      // cap each command, so a Redis problem never slows API requests down.
      enableOfflineQueue: false,
      commandTimeout: 300,
    })
  : null;
// An unhandled "error" event would crash the process; the store errors are
// already handled per request (passOnStoreError).
redis?.on("error", (err) =>
  console.error("Rate-limit Redis error:", err.message),
);

export const rateLimitStore = (namespace: string) => {
  if (!redis) return undefined;
  let windowMs = 60_000;
  const prefix = `els:rate-limit:${namespace}:`;
  const script = `
    local hits = redis.call('INCR', KEYS[1])
    if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
    return { hits, redis.call('PTTL', KEYS[1]) }
  `;
  return {
    localKeys: false,
    // Tells express-rate-limit these keys are namespaced. Without it, a request
    // that passes two limiters (e.g. the general and the recovery one) looks
    // like one key counted twice and logs ERR_ERL_DOUBLE_COUNT.
    prefix,
    init: (options: NonNullable<Parameters<typeof rateLimit>[0]>) => {
      windowMs = options.windowMs ?? 60_000;
    },
    async get(key: string) {
      const results = await redis!
        .multi()
        .get(`${prefix}${key}`)
        .pttl(`${prefix}${key}`)
        .exec();
      const count = Number(results?.[0]?.[1]);
      const remaining = Number(results?.[1]?.[1]);
      if (
        !Number.isFinite(count) ||
        !Number.isFinite(remaining) ||
        remaining < 0
      )
        return undefined;
      return { totalHits: count, resetTime: new Date(Date.now() + remaining) };
    },
    async increment(key: string) {
      const result = (await redis!.eval(
        script,
        1,
        `${prefix}${key}`,
        windowMs,
      )) as [number, number];
      return {
        totalHits: Number(result[0]),
        resetTime: new Date(Date.now() + Number(result[1])),
      };
    },
    async decrement(key: string) {
      await redis!.decr(`${prefix}${key}`);
    },
    async resetKey(key: string) {
      await redis!.del(`${prefix}${key}`);
    },
    async resetAll() {
      let cursor = "0";
      do {
        const [next, keys] = await redis!.scan(
          cursor,
          "MATCH",
          `${prefix}*`,
          "COUNT",
          500,
        );
        cursor = next;
        if (keys.length) await redis!.del(...keys);
      } while (cursor !== "0");
    },
  };
};
