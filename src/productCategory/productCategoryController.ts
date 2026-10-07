import { Request, Response } from "express";
import { ProductCategoryService } from "./productCategoryService";
import { ApiError } from "../middleware/apiError";

const service = new ProductCategoryService();

export class ProductCategoryController {
  public static list = async (_req: Request, res: Response) => {
    return res.status(200).json(await service.listActive());
  };

  public static listAll = async (_req: Request, res: Response) => {
    return res.status(200).json(await service.listAll());
  };

  public static create = async (req: Request, res: Response) => {
    const { name } = req.body ?? {};
    if (!name || typeof name !== "string") {
      throw new ApiError("Category name is required", 400);
    }
    return res.status(201).json(await service.create({ name }));
  };

  public static update = async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw new ApiError("Category ID is required", 400);
    const { name, active, order } = req.body ?? {};
    return res
      .status(200)
      .json(await service.update(id, { name, active, order }));
  };

  public static remove = async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw new ApiError("Category ID is required", 400);
    return res.status(200).json(await service.remove(id));
  };
}
