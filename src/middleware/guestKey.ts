import { NextFunction, Request, Response } from "express";
import { randomBytes, timingSafeEqual } from "crypto";
import rateLimit from "express-rate-limit";
import { env } from "../config/env.config";
import { createTenantClient } from "../tenant/tenantClient";
import { ApiError } from "./apiError";
import { rateLimitStore } from "./rateLimitStore";

// Guest endpoints (booking, paying and buying without an account) need the
// app's guest key. The web app fetches the current key at runtime, so it can
// be rotated from the super admin dashboard without redeploying.
//
// Be clear about what this is: the key reaches the browser, so anyone who looks
// hard enough can read it. It keeps hard-coded scripts and leaked keys out
// (rotate and they stop working), and it works together with the per-IP limit
// below. It isn't a substitute for either.

const { raw } = createTenantClient();
const GRACE_MS = 24 * 60 * 60 * 1000;
const newKey = () => "gk_" + randomBytes(24).toString("base64url");

type Keys = {
  current: string;
  previous: string | null;
  previousUntil: Date | null;
  rotatedAt: Date | null;
};
let cache: { at: number; keys: Keys } | null = null;

const load = async (): Promise<Keys> => {
  if (cache && Date.now() - cache.at < 15_000) return cache.keys;
  let row =
    (await raw.platformConfig.findFirst()) ??
    (await raw.platformConfig.create({ data: {} }));
  if (!row.guestKeyCurrent) {
    row = await raw.platformConfig.update({
      where: { id: row.id },
      data: { guestKeyCurrent: newKey(), guestKeyRotatedAt: new Date() },
    });
  }
  const keys = {
    current: row.guestKeyCurrent!,
    previous: row.guestKeyPrevious,
    previousUntil: row.guestKeyPreviousUntil,
    rotatedAt: row.guestKeyRotatedAt,
  };
  cache = { at: Date.now(), keys };
  return keys;
};

/** The key the web app should send now. */
export const currentGuestKey = async () => (await load()).current;

/** For the super admin: when it last changed and how it ends, never the key itself. */
export const guestKeyStatus = async () => {
  const k = await load();
  const previousActive = Boolean(
    k.previous && k.previousUntil && k.previousUntil > new Date(),
  );
  return {
    endsWith: k.current.slice(-4),
    rotatedAt: k.rotatedAt,
    previousValidUntil: previousActive ? k.previousUntil : null,
  };
};

/** Make a new key. The old one keeps working for 24 hours. */
export const rotateGuestKey = async () => {
  const cur = await load();
  const row = (await raw.platformConfig.findFirst())!;
  await raw.platformConfig.update({
    where: { id: row.id },
    data: {
      guestKeyCurrent: newKey(),
      guestKeyPrevious: cur.current,
      guestKeyPreviousUntil: new Date(Date.now() + GRACE_MS),
      guestKeyRotatedAt: new Date(),
    },
  });
  cache = null;
  return guestKeyStatus();
};

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export const requireGuestKey = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    const given = String(req.header("x-guest-key") ?? "");
    if (!given) throw new ApiError("This request isn't allowed", 401);
    const k = await load();
    const valid = [
      k.current,
      ...(k.previous && k.previousUntil && k.previousUntil > new Date()
        ? [k.previous]
        : []),
      ...env.guestApiKeys, // optional fixed keys, for tests or a partner
    ];
    if (!valid.some((v) => same(given, v)))
      throw new ApiError("This request isn't allowed", 401);
    return next();
  } catch (e) {
    return next(e);
  }
};

/** At most 20 guest bookings, payments or orders per IP every 10 minutes. */
export const guestLimiter = rateLimit({
  ...(rateLimitStore("guest")
    ? { store: rateLimitStore("guest") as never }
    : {}),
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    status: "fail",
    message:
      "Too many attempts from this connection. Please wait a few minutes and try again.",
  },
});

/** Fetching the key is limited too, so it can't be hammered. */
export const guestKeyFetchLimiter = rateLimit({
  ...(rateLimitStore("guest-key")
    ? { store: rateLimitStore("guest-key") as never }
    : {}),
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    status: "fail",
    message: "Too many requests. Please wait a minute.",
  },
});
