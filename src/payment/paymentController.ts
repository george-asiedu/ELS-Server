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

  // Customer — charge their own booking via mobile money (phone prompt).
  public static chargeMomo = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { appointmentId, type, phone, provider } = req.body ?? {};
      if (!appointmentId) throw new ApiError("appointmentId is required", 400);
      if (!phone || !provider) {
        throw new ApiError("phone and provider are required", 400);
      }
      const paymentType = type === "PARTIAL" ? "PARTIAL" : "FULL";
      const result = await paymentService.chargeMomoBooking(
        appointmentId,
        paymentType,
        req.user.id,
        String(phone).trim(),
        String(provider).trim().toLowerCase(),
      );
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  // Submit an OTP for a mobile-money charge that requested one.
  public static submitOtp = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { reference, otp } = req.body ?? {};
      if (!reference || !otp) {
        throw new ApiError("reference and otp are required", 400);
      }
      const result = await paymentService.submitMomoOtp(
        String(reference),
        String(otp).trim(),
      );
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  // Poll the status of a charge (mobile money or inline popup).
  public static status = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const reference = String(req.query.reference || "");
      if (!reference) throw new ApiError("reference is required", 400);
      const result = await paymentService.chargeStatus(reference);
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

  // Combined booking + products charge (shared reference).
  public static verifyCombined = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const reference = String(req.query.reference || "");
      if (!reference) throw new ApiError("reference is required", 400);
      const result = await paymentService.verifyCombined(reference);
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
