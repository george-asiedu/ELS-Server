import { Request, Response, NextFunction } from "express";
import { OnboardingService } from "./onboardingService";
import { ApiError } from "../middleware/apiError";

const onboardingService = new OnboardingService();

export class OnboardingController {
  public static availability = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const slug = String(req.query.slug ?? "");
      if (!slug) throw new ApiError("slug is required", 400);
      const result = await onboardingService.availability(slug);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static start = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await onboardingService.start(req.body ?? {});
      return res.status(201).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static status = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const reference = String(req.query.reference ?? "");
      if (!reference) throw new ApiError("reference is required", 400);
      const result = await onboardingService.status(reference);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };
}
