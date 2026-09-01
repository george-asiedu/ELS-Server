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
  "SENDGRID_API_KEY",
  "SENDER_EMAIL",
  "CLIENT_URL",
  "PAYSTACK_SECRET_KEY",
  "PAYSTACK_PUBLIC_KEY"
];
const missing = requiredVars.filter((v) => !process.env[v]);

if (missing.length > 0) {
  throw new Error(
    `Missing required environment variables in ${envFilePath}: ${missing.join(", ")}`,
  );
}

export const env = {
  port: Number(process.env.PORT),
  databaseUrl: process.env.DATABASE_URL as string,
  nodeEnv: process.env.NODE_ENV as string,
  JWT_SECRET: process.env.JWT_SECRET as string,
  JWT_EXPIRATION: process.env.JWT_EXPIRATION as string,
  JWT_REFRESH_EXPIRES: process.env.JWT_REFRESH_EXPIRES as string,
  aws: {
    s3BucketName: process.env.AWS_S3_BUCKET_NAME as string,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string,
    region: process.env.AWS_REGION as string,
  },
  sendGridApiKey: process.env.SENDGRID_API_KEY as string,
  senderEmail: process.env.SENDER_EMAIL as string,
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
      STANDARD_MONTHLY: (process.env.PAYSTACK_PLAN_STANDARD_MONTHLY as string) || "",
      STANDARD_YEARLY: (process.env.PAYSTACK_PLAN_STANDARD_YEARLY as string) || "",
      PREMIUM_MONTHLY: (process.env.PAYSTACK_PLAN_PREMIUM_MONTHLY as string) || "",
      PREMIUM_YEARLY: (process.env.PAYSTACK_PLAN_PREMIUM_YEARLY as string) || "",
    },
    // Plan prices in GHS per period. Charged as a one-time Mobile Money payment
    // at signup/renewal; keep in sync with the frontend PLANS display prices.
    prices: {
      STANDARD_MONTHLY: Number(process.env.PLAN_STANDARD_MONTHLY) || 150,
      STANDARD_YEARLY: Number(process.env.PLAN_STANDARD_YEARLY) || 1500,
      PREMIUM_MONTHLY: Number(process.env.PLAN_PREMIUM_MONTHLY) || 350,
      PREMIUM_YEARLY: Number(process.env.PLAN_PREMIUM_YEARLY) || 3500,
    },
  },
};
