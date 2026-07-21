import { Request, Response, NextFunction } from "express";
import { ServiceService } from "./serviceService";
import { ApiError } from "../middleware/apiError";
import { errorMessage } from "../utils/helper";
import { validateCreateService, validateUpdateService } from "./validator";

const serviceService = new ServiceService();

export class ServiceController {
  public static list = async (
    _req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await serviceService.listActive();
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
      const result = await serviceService.listAll();
      return res.status(200).json(result);
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
      if (!id) throw new ApiError("Service ID is required", 400);
      const result = await serviceService.getById(id);
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
      const isValid = validateCreateService(req.body);
      if (!isValid) {
        return res.status(400).json({
          message: errorMessage(validateCreateService.errors),
          errors: validateCreateService.errors,
        });
      }
      const result = await serviceService.create(req.body);
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
      if (!id) throw new ApiError("Service ID is required", 400);
      const isValid = validateUpdateService(req.body);
      if (!isValid) {
        return res.status(400).json({
          message: errorMessage(validateUpdateService.errors),
          errors: validateUpdateService.errors,
        });
      }
      const result = await serviceService.update(id, req.body);
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
      if (!id) throw new ApiError("Service ID is required", 400);
      const result = await serviceService.remove(id);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };
}
