import { Request, Response, NextFunction } from "express";
import { ReviewService } from "./reviewService";
import { ApiError } from "../middleware/apiError";
import { errorMessage } from "../utils/helper";
import { validateApproveReview, validateCreateReview } from "./validator";

const reviewService = new ReviewService();

export class ReviewController {
  public static create = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      if (!req.user) throw new ApiError("Authentication required", 401);
      const isValid = validateCreateReview(req.body);
      if (!isValid) {
        return res.status(400).json({
          message: errorMessage(validateCreateReview.errors),
          errors: validateCreateReview.errors,
        });
      }
      const result = await reviewService.create(req.user.id, req.body);
      return res.status(201).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static listApproved = async (
    _req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await reviewService.listApproved();
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static listAll = async (
    _req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await reviewService.listAll();
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static approve = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      if (!id) throw new ApiError("Review ID is required", 400);
      const isValid = validateApproveReview(req.body);
      if (!isValid) {
        return res.status(400).json({
          message: errorMessage(validateApproveReview.errors),
          errors: validateApproveReview.errors,
        });
      }
      const result = await reviewService.setApproved(id, req.body.approved);
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
      if (!id) throw new ApiError("Review ID is required", 400);
      const result = await reviewService.remove(id);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };
}
