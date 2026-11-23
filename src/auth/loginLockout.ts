import { createHash } from "crypto";
import { createTenantClient } from "../tenant/tenantClient";
import { ApiError } from "../middleware/apiError";
import { HttpCode } from "../models/status_codes";
import { getPasswordHash } from "../utils/helper";

const MAX_ATTEMPTS = 3;
const FIRST_LOCK_MINUTES = 15;
const REPEAT_LOCK_MINUTES = 120;
// A quiet day clears the record, so typos weeks apart never add up.
const FORGET_AFTER_MS = 24 * 60 * 60 * 1000;

const { raw } = createTenantClient();

/**
 * Tracked by studio + email whether or not the account exists, and unknown
 * emails lock the same way, so the lock can't reveal who has an account.
 */
export const lockoutKey = (
  studioId: string | null | undefined,
  email: string,
) =>
  createHash("sha256")
    .update(`${studioId ?? "platform"}:${email.trim().toLowerCase()}`)
    .digest("hex");

const waitText = (minutes: number) =>
  minutes >= 60
    ? `${Math.ceil(minutes / 60)} ${minutes > 60 ? "hours" : "hour"}`
    : `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;

const lockedError = (minutes: number) =>
  new ApiError(
    `Too many wrong attempts, so sign-in is locked for ${waitText(minutes)}. If this email has an account, we've sent it instructions.`,
    HttpCode.TOO_MANY_REQUESTS,
  );

export const assertNotLocked = async (key: string) => {
  const row = await raw.loginLockout.findUnique({ where: { key } });
  if (!row?.lockedUntil || row.lockedUntil <= new Date()) return;
  throw lockedError(
    Math.ceil((row.lockedUntil.getTime() - Date.now()) / 60_000),
  );
};

/**
 * Count a wrong password. Returns the lock error on the attempt that trips the
 * lock (the caller throws it, after sending the email), else null.
 */
export const recordLoginFailure = async (key: string) => {
  const now = new Date();
  await raw.loginLockout.updateMany({
    where: {
      key,
      lastFailedAt: { lt: new Date(now.getTime() - FORGET_AFTER_MS) },
    },
    data: { failedCount: 0, lockCount: 0, lockedUntil: null },
  });
  const row = await raw.loginLockout.upsert({
    where: { key },
    create: { key, failedCount: 1, lastFailedAt: now },
    update: { failedCount: { increment: 1 }, lastFailedAt: now },
  });
  if (row.failedCount < MAX_ATTEMPTS) return null;

  const minutes = row.lockCount > 0 ? REPEAT_LOCK_MINUTES : FIRST_LOCK_MINUTES;
  // The count check makes this one atomic step: simultaneous attempts can't
  // each apply a lock and jump straight to the longer one.
  const won = await raw.loginLockout.updateMany({
    where: { key, failedCount: { gte: MAX_ATTEMPTS } },
    data: {
      failedCount: 0,
      lockCount: { increment: 1 },
      lockedUntil: new Date(now.getTime() + minutes * 60_000),
    },
  });
  // Old records are only useful for a day; tidy up when a lock happens.
  void raw.loginLockout
    .deleteMany({
      where: {
        lastFailedAt: { lt: new Date(now.getTime() - 7 * FORGET_AFTER_MS) },
      },
    })
    .catch(() => undefined);
  return { minutes, error: lockedError(minutes), first: won.count === 1 };
};

export const clearLoginFailures = async (key: string) => {
  await raw.loginLockout.deleteMany({ where: { key } });
};

// Compared against when the email is unknown, so both cases take equally long.
const dummyHash = getPasswordHash("zuri-no-such-account");
export const unknownUserHash = () => dummyHash;
