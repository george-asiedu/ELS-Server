import { Request, Response } from "express";
import { CategoryService } from "./categoryService";
import { ApiError } from "../middleware/apiError";

const categoryService = new CategoryService();

export class CategoryController {
  public static list = async (_req: Request, res: Response) => {
    const result = await categoryService.listActive();
    return res.status(200).json(result);
  };

  public static listAll = async (_req: Request, res: Response) => {
    const result = await categoryService.listAll();
    return res.status(200).json(result);
  };

  public static create = async (req: Request, res: Response) => {
    const name = String(req.body?.name ?? "").trim();
    if (name.length < 2 || name.length > 40) {
      throw new ApiError("Category name must be 2-40 characters", 400);
    }
    const result = await categoryService.create({ name });
    return res.status(201).json(result);
  };

  public static update = async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw new ApiError("Category ID is required", 400);
    const result = await categoryService.update(id, req.body ?? {});
    return res.status(200).json(result);
  };

  public static remove = async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw new ApiError("Category ID is required", 400);
    const result = await categoryService.remove(id);
    return res.status(200).json(result);
  };
}
