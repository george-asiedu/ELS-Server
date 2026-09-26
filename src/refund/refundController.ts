import { Request, Response, NextFunction } from "express";
import { RefundService } from "./refundService";
import { ApiError } from "../middleware/apiError";

const refunds = new RefundService();

const actor = (req: Request) => ({
  id: req.user?.id,
  email: req.user?.email,
  role: req.user?.role,
});

// An omitted amount means "refund everything still refundable" — that is a
// meaningful choice, so only reject a value that is present and unusable.
const parseAmount = (raw: unknown): number | undefined => {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ApiError("Refund amount must be a number greater than 0", 400);
  }
  return n;
};

const parseReason = (raw: unknown): string | undefined => {
  if (typeof raw !== "string") return undefined;
  const r = raw.trim();
  if (!r) return undefined;
  if (r.length > 300) {
    throw new ApiError("Reason must be 300 characters or fewer", 400);
  }
  return r;
};

export class RefundController {
  public static refundPayment = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { paymentId } = req.params;
      if (!paymentId) throw new ApiError("A payment id is required", 400);
      const result = await refunds.refundPayment(paymentId, actor(req), {
        ...(parseAmount(req.body?.amount) !== undefined
          ? { amount: parseAmount(req.body?.amount)! }
          : {}),
        ...(parseReason(req.body?.reason)
          ? { reason: parseReason(req.body?.reason)! }
          : {}),
      });
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static refundOrder = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { orderId } = req.params;
      if (!orderId) throw new ApiError("An order id is required", 400);
      const result = await refunds.refundOrder(orderId, actor(req), {
        ...(parseAmount(req.body?.amount) !== undefined
          ? { amount: parseAmount(req.body?.amount)! }
          : {}),
        ...(parseReason(req.body?.reason)
          ? { reason: parseReason(req.body?.reason)! }
          : {}),
      });
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static list = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const status =
        typeof req.query.status === "string" ? req.query.status : undefined;
      const limit =
        typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
      const result = await refunds.list({
        ...(status ? { status } : {}),
        ...(limit !== undefined ? { limit } : {}),
      });
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };
}
