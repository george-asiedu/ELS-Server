import { Request, Response, NextFunction } from "express";
import { PlatformService } from "./platformService";
import { PlatformAuthService } from "./platformAuthService";
import { AuditService } from "../audit/auditService";
import { ApiError } from "../middleware/apiError";
import { HttpCode } from "../models/status_codes";

const platformService = new PlatformService();
const platformAuthService = new PlatformAuthService();
const audit = new AuditService();

// The signed-in super admin, as an audit actor.
const actor = (req: Request) => ({
  id: req.user?.id,
  email: req.user?.email,
  role: req.user?.role,
});

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

  public static analytics = async (
    _req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await platformService.getAnalytics();
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static getBillingConfig = async (
    _req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const data = await platformService.getBillingConfig();
      return res.status(200).json({ message: "Billing config", data });
    } catch (error) {
      return next(error);
    }
  };

  public static updateBillingConfig = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await platformService.updateBillingConfig(req.body ?? {});
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

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
      await audit.record({
        actor: actor(req),
        action: "studio.provisioned",
        targetType: "Studio",
        targetId: result.id,
        studioId: result.id,
        metadata: { slug: result.slug, name: result.name },
      });
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
      await audit.record({
        actor: actor(req),
        action: "studio.updated",
        targetType: "Studio",
        targetId: id,
        studioId: id,
        metadata: req.body ?? {},
      });
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
      await audit.record({
        actor: actor(req),
        action: "studio.status_changed",
        targetType: "Studio",
        targetId: id,
        studioId: id,
        metadata: { status },
      });
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
      await audit.record({
        actor: actor(req),
        action: "studio.settings_updated",
        targetType: "Studio",
        targetId: id,
        studioId: id,
        metadata: req.body ?? {},
      });
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static listAudit = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const studioId =
        typeof req.query.studioId === "string" ? req.query.studioId : undefined;
      const action =
        typeof req.query.action === "string" ? req.query.action : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const result = await audit.list({ studioId, action, limit });
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
      await audit.record({
        actor: actor(req),
        action: "studio.impersonated",
        targetType: "Studio",
        targetId: id,
        studioId: id,
      });
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };
}
