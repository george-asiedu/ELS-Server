import { Request, Response, NextFunction } from "express";
import { ProductService } from "./productService";
import { ApiError } from "../middleware/apiError";
import { CreateProductInput, UpdateProductInput } from "./productService";

const productService = new ProductService();

// Multipart form fields arrive as strings; coerce the ones we care about.
const toNum = (v: unknown): number | undefined =>
  v === undefined || v === null || v === "" ? undefined : Number(v);
const toBool = (v: unknown): boolean | undefined =>
  v === undefined ? undefined : v === true || v === "true";

const parseBody = (body: Record<string, unknown>): UpdateProductInput => {
  const out: UpdateProductInput = {};
  if (body.name !== undefined) out.name = String(body.name);
  if (body.description !== undefined)
    out.description = body.description === "" ? null : String(body.description);
  const price = toNum(body.price);
  if (price !== undefined) out.price = price;
  if (body.promoPrice !== undefined) {
    const p = toNum(body.promoPrice);
    out.promoPrice = p === undefined ? null : p;
  }
  if (body.category !== undefined) out.category = String(body.category);
  const stock = toNum(body.stock);
  if (stock !== undefined) out.stock = stock;
  const trackStock = toBool(body.trackStock);
  if (trackStock !== undefined) out.trackStock = trackStock;
  const active = toBool(body.active);
  if (active !== undefined) out.active = active;
  const popular = toBool(body.popular);
  if (popular !== undefined) out.popular = popular;
  return out;
};

export class ProductController {
  public static list = async (
    _req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      return res.status(200).json(await productService.listActive());
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
      return res.status(200).json(await productService.listAll());
    } catch (error) {
      return next(error);
    }
  };

  public static getOne = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      if (!id) throw new ApiError("Product ID is required", 400);
      return res.status(200).json(await productService.getById(id));
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
      const parsed = parseBody(req.body ?? {});
      if (!parsed.name) throw new ApiError("Product name is required", 400);
      if (parsed.price === undefined)
        throw new ApiError("A valid price is required", 400);
      if (!parsed.category)
        throw new ApiError("A product category is required", 400);
      const result = await productService.create(
        parsed as CreateProductInput,
        req.file,
      );
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
      if (!id) throw new ApiError("Product ID is required", 400);
      const parsed = parseBody(req.body ?? {});
      const result = await productService.update(id, parsed, req.file);
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
      if (!id) throw new ApiError("Product ID is required", 400);
      return res.status(200).json(await productService.remove(id));
    } catch (error) {
      return next(error);
    }
  };
}
