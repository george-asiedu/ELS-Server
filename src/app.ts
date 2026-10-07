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
import { bootstrapQueues, shutdownQueues } from "./queue";
import { startScheduler, stopScheduler } from "./scheduler/scheduler";
import { createTenantClient } from "./tenant/tenantClient";
import { createHash } from "crypto";
import { rateLimitStore } from "./middleware/rateLimitStore";
import { ApiError } from "./middleware/apiError";
import { HttpCode } from "./models/status_codes";
import { recordPlatformActivity } from "./platform/platformActivityLog";

const app = express();
if (env.trustProxyHops > 0) app.set("trust proxy", env.trustProxyHops);

// Do not log query strings: payment references and password-reset links may
// appear in URLs. Keep enough request metadata for operational diagnosis.
app.use(
  morgan(":method :status :response-time ms", {
    skip: (_req, res) => res.statusCode < 400,
  }),
);
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
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return false;
    }
  } catch {
    return false;
  }
  if (
    protocol !== "https:" &&
    !(env.nodeEnv !== "production" && protocol === "http:")
  ) {
    return false;
  }
  if (
    env.nodeEnv !== "production" &&
    (host === "localhost" || host.startsWith("127.") || host.endsWith(".local"))
  ) {
    return true;
  }
  const root = env.rootDomain?.toLowerCase();
  if (
    !port &&
    root &&
    (host === root || host === `www.${root}` || host.endsWith(`.${root}`))
  ) {
    return true;
  }
  return extraOrigins.includes(origin.toLowerCase().replace(/\/$/, ""));
};

// Rate-limit replies use the same JSON shape as every other API error, so
// the app can show the message instead of "Request failed with status 429".
const limitMessage = (message: string) => ({ status: "fail", message });

const withRateLimitStore = (namespace: string) => {
  const store = rateLimitStore(namespace);
  return store ? { store } : {};
};

app.use(
  cors({
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "X-Studio-Slug",
      "X-Device-Id",
      "Idempotency-Key",
    ],
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
// Attach logging before rate limits and body parsing so rejected or malformed
// API requests are still recorded without inspecting their payloads.
app.use("/api", recordPlatformActivity);

// The general per-IP limit runs on every API request, so in Redis it was one
// billed command per request — several per page view. It's a coarse abuse
// guard, so it stays in process memory (per instance). The limits that guard
// accounts and money below share state through Redis across instances.
//
// One page view makes 8-10 API calls, and mobile networks put many phones
// behind one shared address, so the limit is generous: it's there to stop a
// flood, not to meter normal browsing. Skipped in local development, where
// every request comes from one machine.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: () => env.nodeEnv === "development",
  message: limitMessage(
    "You're sending requests faster than usual. Please wait a few minutes and try again.",
  ),
});
const loginIpLimiter = rateLimit({
  ...withRateLimitStore("login-ip"),
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: limitMessage("Too many sign-in attempts. Try again later."),
});
const loginAccountLimiter = rateLimit({
  ...withRateLimitStore("login-account"),
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) =>
    createHash("sha256")
      .update(
        `${String(req.headers["x-studio-slug"] ?? req.hostname)}:${String(
          req.body?.email ?? "",
        )
          .trim()
          .toLowerCase()}`,
      )
      .digest("hex"),
  message: limitMessage(
    "Too many sign-in attempts for this account. Try again later.",
  ),
});
const sensitiveActionLimiter = rateLimit({
  ...withRateLimitStore("payments"),
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: limitMessage(
    "Too many attempts in a short time. Please wait a minute and try again.",
  ),
});
const accountCreationLimiter = rateLimit({
  ...withRateLimitStore("account-creation"),
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: limitMessage("Too many account creation attempts. Try again later."),
});
const recoveryLimiter = rateLimit({
  ...withRateLimitStore("account-recovery"),
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: limitMessage("Too many recovery attempts. Try again later."),
});
app.use("/api", limiter);
app.use("/api/auth/login", loginIpLimiter);
app.use("/api/platform/auth/login", loginIpLimiter);
app.use("/api/payments", sensitiveActionLimiter);
app.use("/api/orders", sensitiveActionLimiter);
app.use("/api/refunds", sensitiveActionLimiter);
app.use("/api/onboarding", sensitiveActionLimiter);
app.use("/api/auth", sensitiveActionLimiter);
app.use("/api/studio/billing", sensitiveActionLimiter);
app.use("/api/platform/auth", sensitiveActionLimiter);
app.use("/api/auth/signup", accountCreationLimiter);
app.use("/api/auth/forgot-password", recoveryLimiter);
app.use("/api/auth/reset-password", recoveryLimiter);
app.use("/api/platform/auth/forgot-password", recoveryLimiter);
app.use("/api/platform/auth/reset-password", recoveryLimiter);
// Super-admin-triggered reset sends an email to a studio admin — rate-limit it
// like the other recovery paths so it can't be used to mailbomb an owner.
app.use("/api/platform/studios/:id/send-password-reset", recoveryLimiter);

app.use(
  express.json({
    limit: "2mb",
    // Keep the raw body so the Paystack webhook can verify its HMAC signature.
    verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(
  express.urlencoded({ extended: false, limit: "64kb", parameterLimit: 100 }),
);
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

// An unmatched /api path would otherwise hit Express's default handler and get
// an HTML error page, which every client here parses as JSON. Hand it to the
// error handler so the shape matches every other API response.
app.use("/api", (req: Request, _res: Response, next: NextFunction) => {
  next(
    new ApiError(
      `No API endpoint matches ${req.method} ${req.path}`,
      HttpCode.NOT_FOUND,
    ),
  );
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) =>
  globalErrorHandler(err, req, res, next),
);

const port = env.port;
if (!port)
  throw new Error("Port number is not defined in environment variables");

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`Server is running on port ${port}`);
});

// Background email queue (Redis, optional) and the recurring-job scheduler
// (database-backed; see src/scheduler). Both run in-process alongside the API.
bootstrapQueues().catch((error) => {
  console.error("Failed to start queues:", error);
});
if (env.schedulerEnabled) {
  startScheduler().catch((error) => {
    console.error("Failed to start scheduler:", error);
  });
} else {
  console.log(
    "Scheduler off (SCHEDULER_ENABLED is not true): recurring jobs won't run here.",
  );
}

// Graceful shutdown. The host sends SIGTERM before replacing an instance on
// every deploy: stop accepting connections, let in-flight requests and queue
// jobs finish, then release the database pool. A hard deadline makes sure a
// stuck request can't hold the old instance up forever.
const SHUTDOWN_DEADLINE_MS = 25_000;
let shuttingDown = false;
const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received — shutting down`);
  setTimeout(() => {
    console.error("Shutdown deadline passed — exiting");
    process.exit(1);
  }, SHUTDOWN_DEADLINE_MS).unref();

  server.close(async () => {
    await stopScheduler();
    await shutdownQueues().catch((error) =>
      console.error("Error closing queues:", error),
    );
    await createTenantClient()
      .raw.$disconnect()
      .catch(() => undefined);
    process.exit(0);
  });
  // Idle keep-alive sockets would otherwise hold server.close() open.
  server.closeIdleConnections();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
