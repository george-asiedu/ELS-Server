import { Request, Response, NextFunction } from "express";
import { CategoryService } from "./categoryService";
import { ApiError } from "../middleware/apiError";

const categoryService = new CategoryService();

export class CategoryController {
  public static list = async (
    _req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await categoryService.listActive();
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
      const result = await categoryService.listAll();
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static create = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const name = String(req.body?.name ?? "").trim();
      if (name.length < 2 || name.length > 40) {
        throw new ApiError("Category name must be 2-40 characters", 400);
      }
      const result = await categoryService.create({ name });
      return res.status(201).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static update = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      if (!id) throw new ApiError("Category ID is required", 400);
      const result = await categoryService.update(id, req.body ?? {});
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
      if (!id) throw new ApiError("Category ID is required", 400);
      const result = await categoryService.remove(id);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };
}
