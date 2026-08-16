import { Request, Response, NextFunction } from "express";
import { PlatformService } from "./platformService";
import { PlatformAuthService } from "./platformAuthService";
import { ApiError } from "../middleware/apiError";
import { HttpCode } from "../models/status_codes";

const platformService = new PlatformService();
const platformAuthService = new PlatformAuthService();

export class PlatformController {
  // ---- Auth -------------------------------------------------------------

  public static login = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const email = String(req.body?.email ?? "").trim();
      const password = String(req.body?.password ?? "");
      if (!email || !password) {
        throw new ApiError("Email and password are required", HttpCode.BAD_REQUEST);
      }
      const result = await platformAuthService.login(email, password);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static me = (req: Request, res: Response) => {
    return res.status(200).json({
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
    });
  };

  // ---- Studios ----------------------------------------------------------

  public static listStudios = async (
    _req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await platformService.listStudios();
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static getStudio = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      if (!id) throw new ApiError("Studio id is required", HttpCode.BAD_REQUEST);
      const result = await platformService.getStudio(id);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static createStudio = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await platformService.provisionStudio(req.body ?? {});
      return res.status(201).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static updateStudio = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      if (!id) throw new ApiError("Studio id is required", HttpCode.BAD_REQUEST);
      const result = await platformService.updateStudio(id, req.body ?? {});
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static setStatus = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      if (!id) throw new ApiError("Studio id is required", HttpCode.BAD_REQUEST);
      const status = String(req.body?.status ?? "");
      const result = await platformService.setStatus(id, status as never);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static updateSettings = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      if (!id) throw new ApiError("Studio id is required", HttpCode.BAD_REQUEST);
      const result = await platformService.updateSettings(id, req.body ?? {});
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static impersonate = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      if (!id) throw new ApiError("Studio id is required", HttpCode.BAD_REQUEST);
      const result = await platformService.impersonate(id);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };
}
