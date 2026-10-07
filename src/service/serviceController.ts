import { Request, Response } from "express";
import { ServiceService } from "./serviceService";
import { ApiError } from "../middleware/apiError";
import { CreateServiceInput, UpdateServiceInput } from "./serviceModels";
import { validateCreateService, validateUpdateService } from "./validator";
import { parseCursorPage } from "../utils/cursorPagination";
import { assertValid } from "../utils/validation";

const serviceService = new ServiceService();

const parseBody = (body: Record<string, unknown>): UpdateServiceInput => {
  const out: UpdateServiceInput = {};
  if (body.name !== undefined) out.name = String(body.name);
  if (body.category !== undefined) out.category = String(body.category);
  if (
    body.description !== undefined &&
    body.description !== "" &&
    body.description !== null
  )
    out.description = String(body.description);
  if (body.duration !== undefined) out.duration = String(body.duration);
  if (body.price !== undefined && body.price !== "")
    out.price = Number(body.price);
  if (body.promoPrice !== undefined) {
    out.promoPrice =
      body.promoPrice === "" || body.promoPrice === null
        ? null
        : Number(body.promoPrice);
  }
  if (body.popular !== undefined)
    out.popular = body.popular === true || body.popular === "true";
  if (body.active !== undefined)
    out.active = body.active === true || body.active === "true";
  if (body.imageUrl !== undefined && body.imageUrl !== null)
    out.imageUrl = String(body.imageUrl);
  return out;
};

export class ServiceController {
  public static list = async (req: Request, res: Response) => {
    const page = parseCursorPage(req.query.cursor, req.query.limit);
    const result = await serviceService.listActive(page);
    return res.status(200).json(result);
  };

  public static listAll = async (req: Request, res: Response) => {
    const page = parseCursorPage(req.query.cursor, req.query.limit);
    const result = await serviceService.listAll(page);
    return res.status(200).json(result);
  };

  public static getOne = async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw new ApiError("Service ID is required", 400);
    const result = await serviceService.getById(id);
    return res.status(200).json(result);
  };

  public static create = async (req: Request, res: Response) => {
    const parsed = parseBody(req.body ?? {});
    assertValid(validateCreateService, parsed as CreateServiceInput);
    const result = await serviceService.create(parsed as CreateServiceInput);
    return res.status(201).json(result);
  };

  public static update = async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw new ApiError("Service ID is required", 400);
    const parsed = parseBody(req.body ?? {});
    assertValid(validateUpdateService, parsed);
    const result = await serviceService.update(id, parsed);
    return res.status(200).json(result);
  };

  public static remove = async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw new ApiError("Service ID is required", 400);
    const result = await serviceService.remove(id);
    return res.status(200).json(result);
  };
}
