import Redis from "ioredis";
import rateLimit from "express-rate-limit";
import { env } from "../config/env.config";

// Share the application's configured Redis connection while giving each
// limiter an independent key namespace. Without REDIS_URL, express-rate-limit
// uses its built-in in-process store (suitable for local/single-instance use).
const redis = env.redisUrl ? new Redis(env.redisUrl, { maxRetriesPerRequest: 1 }) : null;

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
    init: (options: NonNullable<Parameters<typeof rateLimit>[0]>) => { windowMs = options.windowMs ?? 60_000; },
    async get(key: string) {
      const results = await redis!.multi().get(`${prefix}${key}`).pttl(`${prefix}${key}`).exec();
      const count = Number(results?.[0]?.[1]);
      const remaining = Number(results?.[1]?.[1]);
      if (!Number.isFinite(count) || !Number.isFinite(remaining) || remaining < 0) return undefined;
      return { totalHits: count, resetTime: new Date(Date.now() + remaining) };
    },
    async increment(key: string) {
      const result = await redis!.eval(script, 1, `${prefix}${key}`, windowMs) as [number, number];
      return { totalHits: Number(result[0]), resetTime: new Date(Date.now() + Number(result[1])) };
    },
    async decrement(key: string) { await redis!.decr(`${prefix}${key}`); },
    async resetKey(key: string) { await redis!.del(`${prefix}${key}`); },
    async resetAll() {
      let cursor = "0";
      do {
        const [next, keys] = await redis!.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 500);
        cursor = next;
        if (keys.length) await redis!.del(...keys);
      } while (cursor !== "0");
    },
  };
};
