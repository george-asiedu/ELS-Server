import dotenv from "dotenv";
import path from "path";

const envFilePath = path.resolve(process.cwd(), `.env`);

dotenv.config({ path: envFilePath });
const requiredVars = [
  "PORT",
  "DATABASE_URL",
  "JWT_SECRET",
  "JWT_REFRESH_EXPIRES",
  "JWT_EXPIRATION",
  "NODE_ENV",
  "AWS_S3_BUCKET_NAME",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_REGION",
  "AWS_CLOUDFRONT_URL",
  "PLUNK_SECRET_KEY",
  "SENDER_EMAIL",
  "CLIENT_URL",
  "PAYSTACK_SECRET_KEY",
  "PAYSTACK_PUBLIC_KEY",
];
const missing = requiredVars.filter((v) => !process.env[v]);

// How many reverse proxies sit in front of the app. Without the right value
// every request appears to come from the proxy, so per-IP rate limits turn
// into one shared limit for all visitors. Render puts one load balancer in
// front and sets RENDER=true, so that's the default there; elsewhere it's 0
// unless TRUST_PROXY_HOPS says otherwise.
const configuredTrustProxyHops = Number(
  process.env.TRUST_PROXY_HOPS ?? (process.env.RENDER === "true" ? 1 : 0),
);
const trustProxyHops =
  Number.isSafeInteger(configuredTrustProxyHops) &&
  configuredTrustProxyHops >= 0
    ? configuredTrustProxyHops
    : 0;

if (missing.length > 0) {
  throw new Error(
    `Missing required environment variables in ${envFilePath}: ${missing.join(", ")}`,
  );
}

export const env = {
  port: Number(process.env.PORT),
  databaseUrl: process.env.DATABASE_URL as string,
  nodeEnv: (process.env.NODE_ENV as string).trim().toLowerCase(),
  // Defaults to trusting no proxy headers; configure to match the real proxy chain.
  trustProxyHops,
  JWT_SECRET: process.env.JWT_SECRET as string,
  JWT_EXPIRATION: process.env.JWT_EXPIRATION as string,
  JWT_REFRESH_EXPIRES: process.env.JWT_REFRESH_EXPIRES as string,
  aws: {
    s3BucketName: process.env.AWS_S3_BUCKET_NAME as string,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string,
    region: process.env.AWS_REGION as string,
    cloudFrontUrl: ((process.env.AWS_CLOUDFRONT_URL as string) || "").replace(
      /\/$/,
      "",
    ),
  },
  senderEmail: process.env.SENDER_EMAIL as string,
  // Plunk transactional email (replaces SendGrid). apiUrl is overridable in case
  // the account is on a different Plunk host.
  //
  // NOTE ON ATTACHMENTS: receipts are sent as PDF attachments (see
  // notifications/receiptPdf.ts). Plunk documents `attachments` on its
  // /v1/email/send endpoint, while the default below is the older /v1/send.
  // If receipts arrive with the body but no PDF, the endpoint is silently
  // ignoring the field — set PLUNK_API_URL to
  // https://api.useplunk.com/v1/email/send and re-test.
  plunk: {
    secretKey: process.env.PLUNK_SECRET_KEY as string,
    apiUrl:
      (process.env.PLUNK_API_URL as string) ||
      "https://next-api.useplunk.com/v1/send",
  },
  // Optional. When set, BullMQ queues (email sending, payment reconciliation)
  // run against this Redis instance and jobs are processed in the background
  // with retries. When unset, the app still works: emails send synchronously
  // inline and there's no reconciliation sweep — see src/queue/README.md.
  redisUrl: (process.env.REDIS_URL as string) || "",
  // Recurring jobs (reconciliation, reminders) run from this process. On by
  // default only in production, so a laptop pointed at a shared database
  // doesn't start sending reminder emails. Set SCHEDULER_ENABLED=true|false to
  // override. Each job can also be switched off from the platform console.
  schedulerEnabled:
    process.env.SCHEDULER_ENABLED !== undefined
      ? process.env.SCHEDULER_ENABLED.trim().toLowerCase() === "true"
      : (process.env.NODE_ENV ?? "").trim().toLowerCase() === "production",
  clientUrl: process.env.CLIENT_URL as string,
  // Studio slug used when a request carries no studio hint (subdomain/header).
  // Bridges the existing single-tenant frontend during the multi-tenant rollout.
  defaultStudioSlug: (process.env.DEFAULT_STUDIO_SLUG as string) || "els",
  // Apex host of the platform, e.g. "app.example.com"; its subdomains are
  // studios and the apex itself is the super-admin surface.
  rootDomain: (process.env.ROOT_DOMAIN as string) || "",
  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY as string,
    publicKey: process.env.PAYSTACK_PUBLIC_KEY as string,
    // Subscription plan codes (created once on Paystack). Retained for reference
    // but no longer used for billing: Paystack subscriptions can only be charged
    // to a card, and Ghana studios pay by Mobile Money, which cannot auto-recur.
    // Billing is therefore a one-time charge per period + manual renewal.
    plans: {
      STANDARD_MONTHLY:
        (process.env.PAYSTACK_PLAN_STANDARD_MONTHLY as string) || "",
      STANDARD_YEARLY:
        (process.env.PAYSTACK_PLAN_STANDARD_YEARLY as string) || "",
      PREMIUM_MONTHLY:
        (process.env.PAYSTACK_PLAN_PREMIUM_MONTHLY as string) || "",
      PREMIUM_YEARLY:
        (process.env.PAYSTACK_PLAN_PREMIUM_YEARLY as string) || "",
    },
    // Default plan prices in GHS per period, used until the super admin sets
    // prices in the platform console (Billing). The console's values are what
    // is charged and shown; these are only the fallback. The *_YEARLY values
    // are no longer read: a yearly price is always 10x the monthly one (see
    // YEARLY_MONTHS_CHARGED in platform/platformService).
    prices: {
      STANDARD_MONTHLY: Number(process.env.PLAN_STANDARD_MONTHLY) || 150,
      STANDARD_YEARLY: Number(process.env.PLAN_STANDARD_YEARLY) || 1500,
      PREMIUM_MONTHLY: Number(process.env.PLAN_PREMIUM_MONTHLY) || 350,
      PREMIUM_YEARLY: Number(process.env.PLAN_PREMIUM_YEARLY) || 3500,
    },
  },
};
