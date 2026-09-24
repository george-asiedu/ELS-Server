import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import compression from "compression";
import morgan from "morgan";
import hpp from "hpp";
import { xss } from "express-xss-sanitizer";
import { env } from "./config/env.config";
import { globalErrorHandler } from "./middleware/globalErrorHandler";
import { resolveTenant } from "./middleware/tenant";
import routes from "./routes/index";
import { bootstrapQueues } from "./queue";
import { createHash } from "crypto";
import { rateLimitStore } from "./middleware/rateLimitStore";
import { ApiError } from "./middleware/apiError";
import { HttpCode } from "./models/status_codes";

const app = express();
if (env.trustProxyHops > 0) app.set("trust proxy", env.trustProxyHops);

// Do not log query strings: payment references and password-reset links may
// appear in URLs. Keep enough request metadata for operational diagnosis.
app.use(morgan(':method :status :response-time ms', {
  skip: (_req, res) => res.statusCode < 400,
}));
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    referrerPolicy: { policy: "no-referrer" },
  }),
);

// CORS: allow only the platform apex + its studio subdomains (e.g.
// zuristudios.com and <slug>.zuristudios.com), localhost in dev, and any hosts
// explicitly listed in ALLOWED_ORIGINS (comma-separated — e.g. a studio's
// verified custom domain or the *.vercel.app preview). Everything else is
// rejected. No credentials are used (Bearer-token auth), so this is safe.
const extraOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim().toLowerCase().replace(/\/$/, ""))
  .filter(Boolean);

const isAllowedOrigin = (origin: string): boolean => {
  let host: string;
  let protocol: string;
  let port: string;
  try {
    const parsed = new URL(origin);
    host = parsed.hostname.toLowerCase();
    protocol = parsed.protocol;
    port = parsed.port;
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      return false;
    }
  } catch {
    return false;
  }
  if (protocol !== "https:" && !(env.nodeEnv !== "production" && protocol === "http:")) {
    return false;
  }
  if (env.nodeEnv !== "production" && (host === "localhost" || host.startsWith("127.") || host.endsWith(".local"))) {
    return true;
  }
  const root = env.rootDomain?.toLowerCase();
  if (!port && root && (host === root || host === `www.${root}` || host.endsWith(`.${root}`))) {
    return true;
  }
  return extraOrigins.includes(origin.toLowerCase().replace(/\/$/, ""));
};

const withRateLimitStore = (namespace: string) => {
  const store = rateLimitStore(namespace);
  return store ? { store } : {};
};

app.use(
  cors({
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "X-Studio-Slug", "X-Device-Id", "Idempotency-Key"],
    maxAge: 600,
    origin: (origin, cb) => {
      // No Origin header = same-origin, curl, or server-to-server (e.g. the
      // Paystack webhook) — allow; browsers always send Origin on cross-site.
      if (!origin) return cb(null, true);
      if (isAllowedOrigin(origin)) return cb(null, true);
      return cb(new ApiError("Origin is not allowed", HttpCode.FORBIDDEN));
    },
  }),
);
app.use(hpp());

const limiter = rateLimit({
  ...withRateLimitStore("api"),
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: "Too many requests from this IP, please try again later.",
});
const loginIpLimiter = rateLimit({
  ...withRateLimitStore("login-ip"),
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: "Too many sign-in attempts. Try again later.",
});
const loginAccountLimiter = rateLimit({
  ...withRateLimitStore("login-account"),
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => createHash("sha256")
    .update(`${String(req.headers["x-studio-slug"] ?? req.hostname)}:${String(req.body?.email ?? "").trim().toLowerCase()}`)
    .digest("hex"),
  message: "Too many sign-in attempts for this account. Try again later.",
});
const sensitiveActionLimiter = rateLimit({
  ...withRateLimitStore("payments"),
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: "Too many requests from this IP, please try again later.",
});
const accountCreationLimiter = rateLimit({
  ...withRateLimitStore("account-creation"),
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: "Too many account creation attempts. Try again later.",
});
const recoveryLimiter = rateLimit({
  ...withRateLimitStore("account-recovery"),
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: "Too many recovery attempts. Try again later.",
});
app.use("/api", limiter);
app.use("/api/auth/login", loginIpLimiter);
app.use("/api/platform/auth/login", loginIpLimiter);
app.use("/api/payments", sensitiveActionLimiter);
app.use("/api/orders", sensitiveActionLimiter);
app.use("/api/onboarding", sensitiveActionLimiter);
app.use("/api/auth", sensitiveActionLimiter);
app.use("/api/studio/billing", sensitiveActionLimiter);
app.use("/api/platform/auth", sensitiveActionLimiter);
app.use("/api/auth/signup", accountCreationLimiter);
app.use("/api/auth/forgot-password", recoveryLimiter);
app.use("/api/auth/reset-password", recoveryLimiter);
app.use("/api/platform/auth/forgot-password", recoveryLimiter);
app.use("/api/platform/auth/reset-password", recoveryLimiter);

app.use(
  express.json({
    limit: "2mb",
    // Keep the raw body so the Paystack webhook can verify its HMAC signature.
    verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: false, limit: "64kb", parameterLimit: 100 }));
app.use("/api/auth/login", loginAccountLimiter);
app.use("/api/platform/auth/login", loginAccountLimiter);
app.use(xss());
app.use(compression());

app.get("/", (_req: Request, res: Response) => {
  res.send("Welcome to the Zuri Studios API!");
});

// Health check endpoint
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Resolve the studio (tenant) for every API request before the routes run, so
// services query within the right studio's scope.
app.use("/api", resolveTenant);
app.use("/api", routes);

app.use((err: Error, req: Request, res: Response, next: NextFunction) =>
  globalErrorHandler(err, req, res, next),
);

const port = env.port;
if (!port)
  throw new Error("Port number is not defined in environment variables");

app.listen(port, "0.0.0.0", () => {
  console.log(`Server is running on port ${port}`);
});

// Background job queues (email sending, payment reconciliation). Started
// in-process alongside the API — fine at this scale; see queue/README.md for
// how to split workers into a separate Render service later if load grows.
bootstrapQueues().catch((error) => {
  console.error("Failed to start queues:", error);
});
