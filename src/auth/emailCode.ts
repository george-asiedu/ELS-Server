import { createHmac, randomInt, timingSafeEqual } from "crypto";
import { createTenantClient } from "../tenant/tenantClient";
import { env } from "../config/env.config";
import { ApiError } from "../middleware/apiError";
import { HttpCode } from "../models/status_codes";
import { NotificationService } from "../notifications/notificationService";
import { NotificationTemplate } from "../notifications/registry";
import { emailVerificationCode } from "../notifications/templates/auth";
import { EmailBrand } from "../notifications/types";

const CODE_MINUTES = 15;
const MAX_ATTEMPTS = 5;
const RESEND_MS = 60_000;

const { raw } = createTenantClient();
const notifications = new NotificationService();

const hash = (key: string, code: string) =>
  createHmac("sha256", env.JWT_SECRET).update(`${key}:${code}`).digest("hex");

/** Email a 6-digit code. `key` is what's being verified (stored in `email`). */
export const sendEmailCode = async (args: {
  key: string;
  to: string;
  brand: EmailBrand;
  studioId?: string | null;
}) => {
  const now = new Date();
  const existing = await raw.emailVerification.findUnique({
    where: { email: args.key },
  });
  if (existing && now.getTime() - existing.sentAt.getTime() < RESEND_MS) {
    throw new ApiError(
      "We just sent a code. Please wait a minute before asking for another.",
      HttpCode.TOO_MANY_REQUESTS,
    );
  }
  const code = String(randomInt(100000, 1000000));
  const row = {
    codeHash: hash(args.key, code),
    attempts: 0,
    sentAt: now,
    expiresAt: new Date(now.getTime() + CODE_MINUTES * 60_000),
  };
  await raw.emailVerification.upsert({
    where: { email: args.key },
    create: { email: args.key, ...row },
    update: row,
  });
  const { subject, html } = emailVerificationCode(args.brand, {
    code,
    expiresInMinutes: CODE_MINUTES,
  });
  await notifications.send({
    template: NotificationTemplate.AUTH_EMAIL_VERIFICATION,
    to: args.to,
    subject,
    html,
    studioId: args.studioId ?? null,
    entityType: "EmailVerification",
    entityId: `${args.key}:${now.getTime()}`,
  });
};

/** Check a code and use it up. Throws the same error for any failure. */
export const confirmEmailCode = async (key: string, rawCode: unknown) => {
  const wrong = new ApiError(
    "That code isn't right or has expired. Check it, or ask for a new one.",
    HttpCode.BAD_REQUEST,
  );
  // Counted first and atomically, so parallel guesses can't pass the limit.
  const counted = await raw.emailVerification.updateMany({
    where: {
      email: key,
      attempts: { lt: MAX_ATTEMPTS },
      expiresAt: { gt: new Date() },
    },
    data: { attempts: { increment: 1 } },
  });
  if (!counted.count) throw wrong;
  const row = await raw.emailVerification.findUnique({ where: { email: key } });
  const given = Buffer.from(hash(key, String(rawCode ?? "").trim()));
  const stored = Buffer.from(row?.codeHash ?? "");
  if (given.length !== stored.length || !timingSafeEqual(given, stored)) {
    throw wrong;
  }
  await raw.emailVerification.delete({ where: { email: key } });
};
