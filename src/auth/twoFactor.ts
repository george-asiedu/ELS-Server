import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "crypto";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import { createTenantClient } from "../tenant/tenantClient";
import { env } from "../config/env.config";
import { ApiError } from "../middleware/apiError";
import { HttpCode } from "../models/status_codes";
import { verifyPassword } from "../utils/helper";
import { recordLoginFailure } from "./loginLockout";

// Authenticator-app two-factor sign-in (TOTP, RFC 6238), as in the Westend
// City Church app: an encrypted secret per user, a QR code to scan, ten
// one-time recovery codes, and no reuse of a code once it has been accepted.

const STEP = 30;
authenticator.options = { window: 1, step: STEP };

const { raw } = createTenantClient();

// AES-256-GCM key: TOTP_ENCRYPTION_KEY (32 bytes, base64) when set, otherwise
// derived from JWT_SECRET so development works without another secret.
const key = (): Buffer =>
  env.totpEncryptionKey
    ? Buffer.from(env.totpEncryptionKey, "base64")
    : createHash("sha256").update(`totp:${env.JWT_SECRET}`).digest();

const encrypt = (plain: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc]
    .map((b) => b.toString("base64url"))
    .join(".");
};

const decrypt = (payload: string): string => {
  const [iv, tag, enc] = payload
    .split(".")
    .map((p) => Buffer.from(p, "base64url"));
  if (!iv || !tag || !enc) throw new Error("Malformed ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString(
    "utf8",
  );
};

// Recovery codes carry ~50 bits of randomness, so a keyed hash is enough (no
// slow password hash needed) and a code can be looked up directly.
const hashRecoveryCode = (code: string) =>
  createHmac("sha256", env.JWT_SECRET).update(`recovery:${code}`).digest("hex");

const bad = (message: string) => new ApiError(message, HttpCode.BAD_REQUEST);

/** 10 codes like "k3f9q-2mxa7", shown once. */
const newRecoveryCodes = (): string[] => {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 10 }, () => {
    const s = Array.from(
      randomBytes(10),
      (b) => alphabet[b % alphabet.length],
    ).join("");
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
};

/**
 * Checks a 6-digit code and records its time step, so the same code (or an
 * older one) can't be used again. Returns false for a wrong or reused code.
 */
const acceptCode = async (
  user: { id: string; totpSecretEnc: string | null; totpLastStep: number | null },
  code: string,
): Promise<boolean> => {
  if (!user.totpSecretEnc || !/^\d{6}$/.test(code)) return false;
  const secret = decrypt(user.totpSecretEnc);
  const now = Math.floor(Date.now() / 1000 / STEP);
  // Which of the allowed steps (one either side of now) the code belongs to.
  const delta = authenticator.checkDelta(code, secret);
  if (delta === null) return false;
  const step = now + delta;
  if (user.totpLastStep !== null && step <= user.totpLastStep) return false;
  // Conditional update: two requests racing with the same code can't both win.
  const res = await raw.user.updateMany({
    where: {
      id: user.id,
      OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }],
    },
    data: { totpLastStep: step },
  });
  return res.count === 1;
};

const useRecoveryCode = async (userId: string, input: string) => {
  const clean = input.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (clean.length !== 10) return false;
  const codeHash = hashRecoveryCode(`${clean.slice(0, 5)}-${clean.slice(5)}`);
  // Conditional update: a code is spent once, even by two racing sign-ins.
  const res = await raw.recoveryCode.updateMany({
    where: { userId, codeHash, usedAt: null },
    data: { usedAt: new Date() },
  });
  return res.count === 1;
};

/** Login's second step: an authenticator code or a recovery code. */
export const verifySignInCode = async (
  user: { id: string; totpSecretEnc: string | null; totpLastStep: number | null },
  input: string,
): Promise<boolean> => {
  const code = input.trim();
  return /^\d{6}$/.test(code)
    ? acceptCode(user, code)
    : useRecoveryCode(user.id, code);
};

/**
 * The second step of any sign-in, after the password checked out. Throws a
 * 401 the client recognises: TOTP_REQUIRED shows the code field; a wrong code
 * counts towards the same lockout as a wrong password.
 */
export const assertSignInCode = async (
  user: {
    id: string;
    totpEnabled: boolean;
    totpSecretEnc: string | null;
    totpLastStep: number | null;
  },
  totp: unknown,
  lockKey: string,
) => {
  if (!user.totpEnabled) return;
  if (typeof totp !== "string" || !totp.trim()) {
    throw new ApiError(
      "Enter the code from your authenticator app",
      HttpCode.UNAUTHORIZED_ACCESS,
      [{ code: "TOTP_REQUIRED" }],
    );
  }
  if (!(await verifySignInCode(user, totp))) {
    const lock = await recordLoginFailure(lockKey);
    if (lock) throw lock.error;
    throw new ApiError("That code isn't right", HttpCode.UNAUTHORIZED_ACCESS, [
      { code: "TOTP_INVALID" },
    ]);
  }
};

const load = (userId: string) =>
  raw.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      password: true,
      totpEnabled: true,
      totpSecretEnc: true,
      totpLastStep: true,
    },
  });

export const twoFactorStatus = async (userId: string) => {
  const [u, left] = await Promise.all([
    load(userId),
    raw.recoveryCode.count({ where: { userId, usedAt: null } }),
  ]);
  return { enabled: u.totpEnabled, recoveryCodesLeft: u.totpEnabled ? left : 0 };
};

/** Step 1: a fresh secret and the QR code to scan. Not on until confirmed. */
export const startTwoFactorSetup = async (userId: string, issuer: string) => {
  const u = await load(userId);
  if (u.totpEnabled) throw bad("Two-step sign-in is already on");
  const secret = authenticator.generateSecret(20);
  await raw.user.update({
    where: { id: u.id },
    data: { totpSecretEnc: encrypt(secret), totpLastStep: null },
  });
  const otpauthUri = authenticator.keyuri(u.email, issuer, secret);
  const qrDataUrl = await QRCode.toDataURL(otpauthUri, { margin: 1, width: 240 });
  return { secret, otpauthUri, qrDataUrl };
};

/** Step 2: the first code from the app turns it on and returns recovery codes. */
export const confirmTwoFactorSetup = async (userId: string, code: unknown) => {
  const u = await load(userId);
  if (u.totpEnabled) throw bad("Two-step sign-in is already on");
  if (!u.totpSecretEnc) throw bad("Start the setup first");
  if (typeof code !== "string" || !(await acceptCode(u, code.trim())))
    throw bad("That code isn't right. Check the time on your phone and try the newest code.");
  const codes = newRecoveryCodes();
  const hashes = codes.map(hashRecoveryCode);
  await raw.$transaction([
    raw.recoveryCode.deleteMany({ where: { userId } }),
    raw.recoveryCode.createMany({
      data: hashes.map((codeHash) => ({ userId, codeHash })),
    }),
    raw.user.update({ where: { id: userId }, data: { totpEnabled: true } }),
  ]);
  return { recoveryCodes: codes };
};

/** Turning it off needs the password and a current code (or a recovery code). */
export const disableTwoFactor = async (
  userId: string,
  password: unknown,
  code: unknown,
) => {
  const u = await load(userId);
  if (!u.totpEnabled) throw bad("Two-step sign-in is already off");
  if (typeof password !== "string" || !(await verifyPassword(password, u.password)))
    throw bad("That password isn't right");
  if (typeof code !== "string" || !(await verifySignInCode(u, code)))
    throw bad("That code isn't right");
  await raw.$transaction([
    raw.recoveryCode.deleteMany({ where: { userId } }),
    raw.user.update({
      where: { id: userId },
      data: { totpEnabled: false, totpSecretEnc: null, totpLastStep: null },
    }),
  ]);
  return { enabled: false };
};

/** New recovery codes (the old ones stop working). Needs a current code. */
export const regenerateRecoveryCodes = async (userId: string, code: unknown) => {
  const u = await load(userId);
  if (!u.totpEnabled) throw bad("Two-step sign-in is off");
  if (typeof code !== "string" || !(await acceptCode(u, code.trim())))
    throw bad("That code isn't right");
  const codes = newRecoveryCodes();
  const hashes = codes.map(hashRecoveryCode);
  await raw.$transaction([
    raw.recoveryCode.deleteMany({ where: { userId } }),
    raw.recoveryCode.createMany({
      data: hashes.map((codeHash) => ({ userId, codeHash })),
    }),
  ]);
  return { recoveryCodes: codes };
};
