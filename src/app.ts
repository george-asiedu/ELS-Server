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

const app = express();

app.use(morgan("dev"));
app.use(
  helmet({
    contentSecurityPolicy: false,
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
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === "localhost" || host.startsWith("127.") || host.endsWith(".local")) {
    return true;
  }
  const root = env.rootDomain?.toLowerCase();
  if (root && (host === root || host === `www.${root}` || host.endsWith(`.${root}`))) {
    return true;
  }
  return extraOrigins.includes(origin.toLowerCase().replace(/\/$/, ""));
};

app.use(
  cors({
    origin: (origin, cb) => {
      // No Origin header = same-origin, curl, or server-to-server (e.g. the
      // Paystack webhook) — allow; browsers always send Origin on cross-site.
      if (!origin) return cb(null, true);
      return cb(null, isAllowedOrigin(origin));
    },
  }),
);
app.use(hpp());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: "Too many requests from this IP, please try again later.",
});
app.use("/api", limiter);

app.use(
  express.json({
    limit: "10mb",
    // Keep the raw body so the Paystack webhook can verify its HMAC signature.
    verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);
app.use(express.urlencoded({ extended: true }));
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
    environment: env.nodeEnv || "development",
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

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
