import { Request, Response, NextFunction } from "express";
import { PlatformReviewService } from "./platformReviewService";
import { ApiError } from "../middleware/apiError";

const service = new PlatformReviewService();

export class PlatformReviewController {
  // Public — approved testimonials for the landing page.
  public static listApproved = async (
    _req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await service.listApproved();
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  // Studio admin — submit / list own.
  public static create = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await service.create(req.studioId, req.user?.id, req.body ?? {});
      return res.status(201).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static listMine = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await service.listForStudio(req.studioId);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  // Super admin — moderate.
  public static listAll = async (
    _req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await service.listAll();
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static setApproved = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      if (!id) throw new ApiError("id is required", 400);
      const result = await service.setApproved(id, Boolean(req.body?.approved));
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static remove = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      if (!id) throw new ApiError("id is required", 400);
      const result = await service.remove(id);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };
}
