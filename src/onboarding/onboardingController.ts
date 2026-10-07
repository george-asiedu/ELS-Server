import { Request, Response } from "express";
import { OnboardingService } from "./onboardingService";
import { ApiError } from "../middleware/apiError";

const onboardingService = new OnboardingService();

export class OnboardingController {
  public static availability = async (req: Request, res: Response) => {
    const slug = String(req.query.slug ?? "");
    if (!slug) throw new ApiError("slug is required", 400);
    const result = await onboardingService.availability(slug);
    return res.status(200).json(result);
  };

  public static config = async (_req: Request, res: Response) => {
    const result = await onboardingService.config();
    return res.status(200).json(result);
  };

  public static start = async (req: Request, res: Response) => {
    const result = await onboardingService.start(req.body ?? {});
    return res.status(201).json(result);
  };

  public static status = async (req: Request, res: Response) => {
    const reference = String(req.query.reference ?? "");
    if (!reference) throw new ApiError("reference is required", 400);
    const result = await onboardingService.status(reference);
    return res.status(200).json(result);
  };
}
