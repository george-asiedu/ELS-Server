import { Request, Response, NextFunction } from "express";
import { ProductCategoryService } from "./productCategoryService";
import { ApiError } from "../middleware/apiError";

const service = new ProductCategoryService();

export class ProductCategoryController {
  public static list = async (
    _req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      return res.status(200).json(await service.listActive());
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
      return res.status(200).json(await service.listAll());
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
      const { name } = req.body ?? {};
      if (!name || typeof name !== "string") {
        throw new ApiError("Category name is required", 400);
      }
      return res.status(201).json(await service.create({ name }));
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
      const { name, active, order } = req.body ?? {};
      return res.status(200).json(await service.update(id, { name, active, order }));
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
      return res.status(200).json(await service.remove(id));
    } catch (error) {
      return next(error);
    }
  };
}
