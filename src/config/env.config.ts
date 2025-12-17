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
  "CLIENT_URL"
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
};
