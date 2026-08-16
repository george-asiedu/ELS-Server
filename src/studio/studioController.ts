import { Request, Response, NextFunction } from "express";
import { StudioService } from "./studioService";
import { S3BucketService } from "../bucket/s3BucketService";

const studioService = new StudioService(new S3BucketService());

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

  // ---- Admin: branding --------------------------------------------------

  public static getBranding = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await studioService.getBranding(req.studioId);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static updateBranding = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await studioService.updateBranding(
        req.studioId,
        req.body ?? {},
        req.file,
      );
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  // ---- Admin: content ---------------------------------------------------

  public static getContent = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await studioService.getContent(req.studioId);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static updateContent = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await studioService.updateContent(
        req.studioId,
        req.body ?? {},
      );
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };
}
