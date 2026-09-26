import { Request, Response, NextFunction } from "express";
import {
  LedgerService,
  LedgerType,
  LedgerStatus,
  LedgerDirection,
} from "./ledgerService";
import { ApiError } from "../middleware/apiError";

const ledger = new LedgerService();

const LEDGER_TYPES = [
  "BOOKING_PAYMENT",
  "ORDER_PAYMENT",
  "SUBSCRIPTION_PAYMENT",
  "REFUND",
  "ADJUSTMENT",
] as const;
const LEDGER_STATUSES = [
  "PENDING",
  "SUCCESS",
  "FAILED",
  "ABANDONED",
  "REVERSED",
] as const;

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

const enumParam = <T extends string>(
  v: unknown,
  allowed: readonly T[],
  label: string,
): T | undefined => {
  const raw = str(v);
  if (!raw) return undefined;
  const upper = raw.toUpperCase() as T;
  if (!allowed.includes(upper)) {
    throw new ApiError(`${label} must be one of: ${allowed.join(", ")}`, 400);
  }
  return upper;
};

const dateParam = (v: unknown, label: string): Date | undefined => {
  const raw = str(v);
  if (!raw) return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new ApiError(`${label} must be a valid date`, 400);
  }
  return d;
};

// Shared by the studio-admin and super-admin routes. `studioId` is only ever
// applied by the super-admin caller; in a studio request the tenant extension
// forces the caller's own studio regardless of what is passed.
const buildQuery = (req: Request, studioId?: string | undefined) => {
  const from = dateParam(req.query.from, "from");
  const to = dateParam(req.query.to, "to");
  if (from && to && from > to) {
    throw new ApiError("`from` must not be after `to`", 400);
  }
  const source = str(req.query.source);
  if (source && source !== "customer" && source !== "studio") {
    throw new ApiError("source must be either 'customer' or 'studio'", 400);
  }
  const limitRaw = str(req.query.limit);
  const limit = limitRaw ? Number(limitRaw) : undefined;
  if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) {
    throw new ApiError("limit must be a positive number", 400);
  }

  return {
    ...(studioId ? { studioId } : {}),
    ...(enumParam<LedgerType>(req.query.type, LEDGER_TYPES, "type")
      ? { type: enumParam<LedgerType>(req.query.type, LEDGER_TYPES, "type") }
      : {}),
    ...(enumParam<LedgerStatus>(req.query.status, LEDGER_STATUSES, "status")
      ? {
          status: enumParam<LedgerStatus>(
            req.query.status,
            LEDGER_STATUSES,
            "status",
          ),
        }
      : {}),
    ...(enumParam<LedgerDirection>(
      req.query.direction,
      ["CREDIT", "DEBIT"],
      "direction",
    )
      ? {
          direction: enumParam<LedgerDirection>(
            req.query.direction,
            ["CREDIT", "DEBIT"],
            "direction",
          ),
        }
      : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(source ? { source: source as "customer" | "studio" } : {}),
    ...(str(req.query.search) ? { search: str(req.query.search) } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(str(req.query.cursor) ? { cursor: str(req.query.cursor) } : {}),
  };
};

export class LedgerController {
  // Studio admin: their own studio's ledger. Scoping is enforced by the tenant
  // extension, not by a parameter.
  public static list = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await ledger.list(buildQuery(req));
      return res.status(200).json({ message: "Transactions", ...result });
    } catch (error) {
      return next(error);
    }
  };

  public static summary = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const from = dateParam(req.query.from, "from");
      const to = dateParam(req.query.to, "to");
      const result = await ledger.summary({
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      });
      return res
        .status(200)
        .json({ message: "Transaction summary", data: result });
    } catch (error) {
      return next(error);
    }
  };

  public static detail = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const id = str(req.params.id);
      if (!id) throw new ApiError("A transaction id is required", 400);
      const result = await ledger.detail(id);
      return res.status(200).json({ message: "Transaction", data: result });
    } catch (error) {
      return next(error);
    }
  };

  // Super admin: any studio's ledger. `studioId` is required so a platform
  // call is always explicit about whose books it is reading.
  public static platformList = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const studioId = str(req.query.studioId) ?? str(req.params.studioId);
      const result = await ledger.list(buildQuery(req, studioId));
      return res.status(200).json({ message: "Transactions", ...result });
    } catch (error) {
      return next(error);
    }
  };

  public static platformSummary = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const studioId = str(req.query.studioId) ?? str(req.params.studioId);
      const from = dateParam(req.query.from, "from");
      const to = dateParam(req.query.to, "to");
      const result = await ledger.summary({
        ...(studioId ? { studioId } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      });
      return res
        .status(200)
        .json({ message: "Transaction summary", data: result });
    } catch (error) {
      return next(error);
    }
  };
}
