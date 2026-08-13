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
app.use(cors());
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
  res.send("Welcome to EL Beauty Studio API!");
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
