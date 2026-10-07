import { Request, Response } from "express";
import {
  loadBillingConfig,
  loadSiteSettings,
  saveSiteSettings,
  PlatformService,
} from "./platformService";
import { PlatformAuthService } from "./platformAuthService";
import { AuditService } from "../audit/auditService";
import { ApiError } from "../middleware/apiError";
import { HttpCode } from "../models/status_codes";
import { revokeLoginSession } from "../auth/sessionService";
import { getLoginDeviceMetadata } from "../auth/loginDevice";

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

  public static logout = async (req: Request, res: Response) => {
    if (req.user && req.authSessionId) {
      await revokeLoginSession(req.authSessionId, req.user.id);
    }
    return res.status(200).json({ message: "Logged out successfully" });
  };

  public static login = async (req: Request, res: Response) => {
    const email = String(req.body?.email ?? "").trim();
    const password = String(req.body?.password ?? "");
    if (!email || !password) {
      throw new ApiError(
        "Email and password are required",
        HttpCode.BAD_REQUEST,
      );
    }
    const result = await platformAuthService.login(
      email,
      password,
      getLoginDeviceMetadata(req),
    );
    return res.status(200).json(result);
  };

  public static forgotPassword = async (req: Request, res: Response) => {
    const email = String(req.body?.email ?? "").trim();
    if (!email) throw new ApiError("Email is required", HttpCode.BAD_REQUEST);
    const result = await platformAuthService.forgotPassword(email);
    return res.status(200).json(result);
  };

  public static resetPassword = async (req: Request, res: Response) => {
    const token = String(req.body?.token ?? "");
    const password = String(req.body?.password ?? "");
    const result = await platformAuthService.resetPassword(token, password);
    return res.status(200).json(result);
  };

  public static me = (req: Request, res: Response) => {
    return res.status(200).json({
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
    });
  };

  // ---- Studios ----------------------------------------------------------

  public static analytics = async (_req: Request, res: Response) => {
    const result = await platformService.getAnalytics();
    return res.status(200).json(result);
  };

  public static getBillingConfig = async (_req: Request, res: Response) => {
    const data = await platformService.getBillingConfig();
    return res.status(200).json({ message: "Billing config", data });
  };

  public static updateBillingConfig = async (req: Request, res: Response) => {
    const before = await platformService.getBillingConfig();
    const result = await platformService.updateBillingConfig(req.body ?? {});
    // Fees decide what new studios pay, so every change is on the record.
    await audit.record({
      actor: { id: req.user.id, email: req.user.email, role: req.user.role },
      action: "platform.billing_config.updated",
      targetType: "PlatformConfig",
      metadata: { before, after: result.data },
    });
    return res.status(200).json(result);
  };

  // Public: what the platform pages need before anyone signs in (site
  // details, plan prices, setup fees). Nothing here is secret.
  public static publicConfig = async (_req: Request, res: Response) => {
    const [site, billing] = await Promise.all([
      loadSiteSettings(),
      loadBillingConfig(),
    ]);
    return res
      .status(200)
      .json({ message: "Platform config", data: { site, billing } });
  };

  public static getSiteSettings = async (_req: Request, res: Response) => {
    return res
      .status(200)
      .json({ message: "Site settings", data: await loadSiteSettings() });
  };

  public static updateSiteSettings = async (req: Request, res: Response) => {
    const before = await loadSiteSettings();
    const after = await saveSiteSettings(req.body ?? {});
    await audit.record({
      actor: { id: req.user.id, email: req.user.email, role: req.user.role },
      action: "platform.site_settings.updated",
      targetType: "PlatformConfig",
      metadata: { before, after },
    });
    return res
      .status(200)
      .json({ message: "Site settings saved", data: after });
  };

  public static listStudios = async (_req: Request, res: Response) => {
    const result = await platformService.listStudios();
    return res.status(200).json(result);
  };

  public static getStudio = async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw new ApiError("Studio id is required", HttpCode.BAD_REQUEST);
    const result = await platformService.getStudio(id);
    return res.status(200).json(result);
  };

  public static createStudio = async (req: Request, res: Response) => {
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
  };

  public static updateStudio = async (req: Request, res: Response) => {
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
  };

  public static deleteStudio = async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw new ApiError("Studio id is required", HttpCode.BAD_REQUEST);
    const result = await platformService.deleteStudio(id);
    await audit.record({
      actor: actor(req),
      action: "studio.deleted",
      targetType: "Studio",
      targetId: id,
      studioId: id,
      metadata: { slug: result.data.slug },
    });
    return res.status(200).json(result);
  };

  public static setStatus = async (req: Request, res: Response) => {
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
  };

  public static updateSettings = async (req: Request, res: Response) => {
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
  };

  public static listAudit = async (req: Request, res: Response) => {
    const studioId =
      typeof req.query.studioId === "string" ? req.query.studioId : undefined;
    const action =
      typeof req.query.action === "string" ? req.query.action : undefined;
    const actionPrefix =
      typeof req.query.actionPrefix === "string"
        ? req.query.actionPrefix
        : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const result = await audit.list({ studioId, action, actionPrefix, limit });
    return res.status(200).json(result);
  };

  /**
   * Super admin asks us to send a studio admin a password-reset link. There is
   * deliberately no "show me their password" counterpart: stored passwords are
   * bcrypt hashes and the original cannot be recovered.
   */
  public static sendStudioAdminPasswordReset = async (
    req: Request,
    res: Response,
  ) => {
    const { id } = req.params;
    if (!id) throw new ApiError("Studio id is required", HttpCode.BAD_REQUEST);
    const userId =
      typeof req.body?.userId === "string" && req.body.userId.trim()
        ? req.body.userId.trim()
        : undefined;
    const result = await platformService.sendStudioAdminPasswordReset(
      id,
      actor(req),
      userId,
    );
    return res.status(200).json(result);
  };

  public static impersonate = async (req: Request, res: Response) => {
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
  };
}
