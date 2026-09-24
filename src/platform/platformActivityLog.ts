import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";
import { Connection } from "../db/dbConnection";
import {
  cursorPageArgs,
  cursorPageResult,
  parseCursorPage,
} from "../utils/cursorPagination";

const db = new Connection();

/** Records API request metadata without retaining URL query strings or payloads. */
export const recordPlatformActivity = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (req.method === "OPTIONS") return next();

  const requestId = randomUUID();
  const startedAt = Date.now();
  res.setHeader("X-Request-Id", requestId);

  res.once("finish", () => {
    const routePath = typeof req.route?.path === "string" ? req.route.path : req.path;
    const route = `${req.baseUrl}${routePath}`.slice(0, 300);
    const userAgent = req.get("user-agent")?.slice(0, 300) ?? null;

    void db.platformActivityLog
      .create({
        data: {
          requestId,
          studioId: req.studioId ?? null,
          actorId: req.user?.id ?? null,
          actorRole: req.user?.role ?? null,
          method: req.method,
          route,
          statusCode: res.statusCode,
          durationMs: Math.max(0, Date.now() - startedAt),
          userAgent,
        },
      })
      .catch((error: unknown) => {
        // Telemetry is best-effort and must never affect the API response.
        console.error("Platform activity log write failed:", error);
      });
  });

  next();
};

export class PlatformActivityLogService extends Connection {
  public async list(opts: {
    cursor?: string | undefined;
    limit: number;
    studioId?: string | undefined;
    statusCode?: number | undefined;
    method?: string | undefined;
  }) {
    const page = parseCursorPage(opts.cursor, String(opts.limit), 50);
    const where: {
      studioId?: string;
      statusCode?: { gte: number; lt: number };
      method?: string;
    } = {};
    if (opts.studioId) where.studioId = opts.studioId;
    if (opts.statusCode !== undefined) {
      where.statusCode = { gte: opts.statusCode, lt: opts.statusCode + 100 };
    }
    if (opts.method) where.method = opts.method.toUpperCase();

    const records = await this.platformActivityLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...cursorPageArgs(page),
    });
    const result = cursorPageResult(records, page);
    return { message: "Platform activity logs", ...result };
  }
}
