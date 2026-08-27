import { Request, Response, NextFunction } from "express";
import { PromoService } from "./promoService";
import { ApiError } from "../middleware/apiError";

const promoService = new PromoService();

export class PromoController {
  public static list = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const placement =
        typeof req.query.placement === "string" ? req.query.placement : undefined;
      const result = await promoService.listActive(placement);
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
      const result = await promoService.listAll();
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
      const result = await promoService.create(req.body ?? {});
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
      if (!id) throw new ApiError("Banner id is required", 400);
      const result = await promoService.update(id, req.body ?? {});
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
      if (!id) throw new ApiError("Banner id is required", 400);
      const result = await promoService.remove(id);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };
}
