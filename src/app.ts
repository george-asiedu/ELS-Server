import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import compression from "compression";
import morgan from "morgan";
import hpp from "hpp";
// @ts-ignore: no type declarations for 'hpp' available
import xssClean from "xss-clean";
import { env } from "./config/env.config";
import { globalErrorHandler } from "./middleware/globalErrorHandler";
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

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
// app.use(xssClean() as any);
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

app.use("/api/v1", routes);

app.use((err: Error, req: Request, res: Response, next: NextFunction) =>
  globalErrorHandler(err, req, res, next),
);

const port = env.port;
if (!port)
  throw new Error("Port number is not defined in environment variables");

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
