import { Request, Response } from "express";
import { ReviewService } from "./reviewService";
import { ApiError } from "../middleware/apiError";
import { validateApproveReview, validateCreateReview } from "./validator";
import { parseCursorPage } from "../utils/cursorPagination";
import { assertValid } from "../utils/validation";

const reviewService = new ReviewService();

export class ReviewController {
  public static create = async (req: Request, res: Response) => {
    if (!req.user) throw new ApiError("Authentication required", 401);
    assertValid(validateCreateReview, req.body);
    const result = await reviewService.create(req.user.id, req.body);
    return res.status(201).json(result);
  };

  public static listApproved = async (_req: Request, res: Response) => {
    const result = await reviewService.listApproved();
    return res.status(200).json(result);
  };

  public static listAll = async (req: Request, res: Response) => {
    const page = parseCursorPage(req.query.cursor, req.query.limit);
    const result = await reviewService.listAll(page);
    return res.status(200).json(result);
  };

  public static approve = async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw new ApiError("Review ID is required", 400);
    assertValid(validateApproveReview, req.body);
    const result = await reviewService.setApproved(id, req.body.approved);
    return res.status(200).json(result);
  };

  public static remove = async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw new ApiError("Review ID is required", 400);
    const result = await reviewService.remove(id);
    return res.status(200).json(result);
  };
}
