import { Request, Response } from "express";
import { CommerceSettingsService } from "./commerceSettingsService";

const service = new CommerceSettingsService();

export class CommerceController {
  public static getSettings = async (_req: Request, res: Response) => {
    return res.status(200).json(await service.get());
  };

  public static updateSettings = async (req: Request, res: Response) => {
    const { enabled, enablePickup, enableDelivery, deliveryFee } =
      req.body ?? {};
    return res.status(200).json(
      await service.update({
        enabled,
        enablePickup,
        enableDelivery,
        deliveryFee,
      }),
    );
  };
}
