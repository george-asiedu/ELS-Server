import { Request, Response } from "express";
import { ProductService } from "./productService";
import { ApiError } from "../middleware/apiError";
import { CreateProductInput, UpdateProductInput } from "./productService";
import { parseCursorPage } from "../utils/cursorPagination";

const productService = new ProductService();

// Multipart form fields arrive as strings; coerce the ones we care about.
const toNum = (v: unknown): number | undefined =>
  v === undefined || v === null || v === "" ? undefined : Number(v);
const toBool = (v: unknown): boolean | undefined =>
  v === undefined ? undefined : v === true || v === "true";

const parseBody = (body: Record<string, unknown>): UpdateProductInput => {
  const out: UpdateProductInput = {};
  for (const key of ["images", "sizes", "colors", "attributes"] as const) {
    if (Array.isArray(body[key]))
      out[key] = (body[key] as unknown[]).map(String);
  }
  if (body.unit !== undefined)
    out.unit =
      body.unit === null || String(body.unit).trim() === ""
        ? null
        : String(body.unit).trim().slice(0, 20);
  if (Array.isArray(body.variants))
    out.variants = (
      body.variants as { label?: unknown; price?: unknown }[]
    ).map((v) => ({ label: String(v?.label ?? ""), price: Number(v?.price) }));
  if (body.name !== undefined) out.name = String(body.name);
  if (body.description !== undefined)
    out.description = body.description === "" ? null : String(body.description);
  const price = toNum(body.price);
  if (price !== undefined) out.price = price;
  const costPrice = toNum(body.costPrice);
  if (costPrice !== undefined) out.costPrice = costPrice;
  if (body.promoPrice !== undefined) {
    const p = toNum(body.promoPrice);
    out.promoPrice = p === undefined ? null : p;
  }
  if (body.category !== undefined) out.category = String(body.category);
  if (body.audience !== undefined) out.audience = String(body.audience);
  if (body.brand !== undefined)
    out.brand =
      body.brand === null || body.brand === ""
        ? null
        : String(body.brand).trim().slice(0, 60);
  const stock = toNum(body.stock);
  if (stock !== undefined) out.stock = stock;
  const trackStock = toBool(body.trackStock);
  if (trackStock !== undefined) out.trackStock = trackStock;
  const active = toBool(body.active);
  if (active !== undefined) out.active = active;
  const popular = toBool(body.popular);
  if (popular !== undefined) out.popular = popular;
  if (body.imageUrl !== undefined)
    out.imageUrl =
      body.imageUrl === null || body.imageUrl === ""
        ? null
        : String(body.imageUrl);
  return out;
};

export class ProductController {
  public static list = async (req: Request, res: Response) => {
    const page = parseCursorPage(req.query.cursor, req.query.limit);
    return res.status(200).json(await productService.listActive(page));
  };

  public static listAll = async (req: Request, res: Response) => {
    const page = parseCursorPage(req.query.cursor, req.query.limit);
    return res.status(200).json(await productService.listAll(page));
  };

  public static getOne = async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw new ApiError("Product ID is required", 400);
    return res.status(200).json(await productService.getById(id));
  };

  public static create = async (req: Request, res: Response) => {
    const parsed = parseBody(req.body ?? {});
    if (!parsed.name) throw new ApiError("Product name is required", 400);
    if (parsed.price === undefined)
      throw new ApiError("A valid price is required", 400);
    if (!parsed.category)
      throw new ApiError("A product category is required", 400);
    const result = await productService.create(parsed as CreateProductInput);
    return res.status(201).json(result);
  };

  public static update = async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw new ApiError("Product ID is required", 400);
    const parsed = parseBody(req.body ?? {});
    const result = await productService.update(id, parsed);
    return res.status(200).json(result);
  };

  public static remove = async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw new ApiError("Product ID is required", 400);
    return res.status(200).json(await productService.remove(id));
  };

  public static listReviews = async (req: Request, res: Response) => {
    return res
      .status(200)
      .json(await productService.listReviews(String(req.params.id)));
  };

  public static addReview = async (req: Request, res: Response) => {
    const result = await productService.addReview(
      req.user.id,
      String(req.params.id),
      Number(req.body?.rating),
      req.body?.content,
    );
    return res.status(201).json(result);
  };
}
