import { Request, Response, NextFunction } from "express";
import { StudioService } from "./studioService";

const studioService = new StudioService();

export class StudioController {
  // Public storefront config for the studio resolved by resolveTenant.
  public static config = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await studioService.getPublicConfig(req.studioId);
      return res.status(200).json({ message: "Studio config", data: result });
    } catch (error) {
      return next(error);
    }
  };
}
