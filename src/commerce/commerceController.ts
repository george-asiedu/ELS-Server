import { Request, Response, NextFunction } from "express";
import { CommerceSettingsService } from "./commerceSettingsService";

const service = new CommerceSettingsService();

export class CommerceController {
  public static getSettings = async (
    _req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      return res.status(200).json(await service.get());
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
      const { enabled, enablePickup, enableDelivery, deliveryFee } =
        req.body ?? {};
      return res
        .status(200)
        .json(
          await service.update({
            enabled,
            enablePickup,
            enableDelivery,
            deliveryFee,
          }),
        );
    } catch (error) {
      return next(error);
    }
  };
}
