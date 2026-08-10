import { Request, Response, NextFunction } from "express";
import { PaymentService } from "./paymentService";
import { PaymentSettingsService } from "./paymentSettingsService";
import { ApiError } from "../middleware/apiError";

const paymentService = new PaymentService();
const settingsService = new PaymentSettingsService();

export class PaymentController {
  // Public — the booking page reads this to show payment options.
  public static getSettings = async (
    _req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await settingsService.get();
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static updateSettings = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { enabled, allowFull, allowPartial, depositPercent } =
        req.body ?? {};
      const result = await settingsService.update({
        enabled,
        allowFull,
        allowPartial,
        depositPercent,
      });
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static initialize = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { appointmentId, type } = req.body ?? {};
      if (!appointmentId) {
        throw new ApiError("appointmentId is required", 400);
      }
      const paymentType = type === "PARTIAL" ? "PARTIAL" : "FULL";
      const result = await paymentService.initialize(
        appointmentId,
        paymentType,
        req.user.id,
      );
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static verify = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const reference = String(req.query.reference || "");
      if (!reference) throw new ApiError("reference is required", 400);
      const result = await paymentService.verify(reference);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static webhook = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const signature = req.headers["x-paystack-signature"] as
        | string
        | undefined;
      const result = await paymentService.handleWebhook(req.rawBody, signature);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };
}
