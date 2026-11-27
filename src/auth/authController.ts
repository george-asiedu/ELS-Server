import { Request, Response } from "express";
import { AuthService } from "./authService";
import { validateSignup } from "./validators/signup";
import { validateLogin } from "./validators/login";
import { ApiError } from "../middleware/apiError";
import { validateEmail, validatePassword } from "../profile/validator/profile";
import { revokeLoginSession } from "./sessionService";
import { getLoginDeviceMetadata } from "./loginDevice";
import { clearSessionCookie, withoutToken } from "./sessionCookie";
import { assertValid } from "../utils/validation";
import {
  confirmTwoFactorSetup,
  disableTwoFactor,
  regenerateRecoveryCodes,
  startTwoFactorSetup,
  twoFactorStatus,
} from "./twoFactor";
import { createTenantClient } from "../tenant/tenantClient";

const { raw } = createTenantClient();

const authService = new AuthService();

export class AuthController {
  public static logout = async (req: Request, res: Response) => {
    if (req.user && req.authSessionId) {
      await revokeLoginSession(req.authSessionId, req.user.id);
    }
    clearSessionCookie(req, res);
    return res.status(200).json({ message: "Logged out successfully" });
  };

  public static signup = async (req: Request, res: Response) => {
    assertValid(validateSignup, req.body);
    const result = await authService.signup(
      req.body,
      getLoginDeviceMetadata(req),
    );
    return res.status(201).json(withoutToken(req, res, result));
  };

  public static login = async (req: Request, res: Response) => {
    assertValid(validateLogin, req.body);
    const result = await authService.login(
      req.body,
      getLoginDeviceMetadata(req),
    );
    return res.status(200).json(withoutToken(req, res, result));
  };

  public static emailStatus = async (req: Request, res: Response) => {
    const result = await authService.emailVerificationStatus(req.user!.id);
    return res.status(200).json(result);
  };

  public static sendEmailCode = async (req: Request, res: Response) => {
    const result = await authService.sendVerificationCode(req.user!);
    return res.status(200).json(result);
  };

  public static confirmEmailCode = async (req: Request, res: Response) => {
    const result = await authService.confirmVerificationCode(
      req.user!.id,
      req.body?.code,
    );
    return res.status(200).json(result);
  };

  public static firstVisitCode = async (req: Request, res: Response) => {
    const email = String(req.body?.email ?? "").trim();
    if (!email) throw new ApiError("Enter your email", 400);
    return res.status(200).json(await authService.firstVisitCode(email));
  };

  public static firstVisitSetPassword = async (req: Request, res: Response) => {
    const body = req.body ?? {};
    const result = await authService.firstVisitSetPassword(
      {
        email: String(body.email ?? "").trim(),
        code: body.code,
        password: String(body.password ?? ""),
      },
      getLoginDeviceMetadata(req),
    );
    return res.status(200).json(withoutToken(req, res, result));
  };

  public static forgotPassword = async (req: Request, res: Response) => {
    assertValid(validateEmail, req.body);

    const result = await authService.forgotPassword(req.body.email);
    return res.status(200).json(result);
  };

  public static resetPassword = async (req: Request, res: Response) => {
    assertValid(validatePassword, req.body);

    const { token } = req.params;
    if (!token) {
      throw new ApiError("Token is required", 400);
    }
    const result = await authService.resetPassword(token, req.body.password);
    return res.status(200).json(result);
  };

  // ---- Two-step sign-in (authenticator app)

  public static twoFactorStatus = async (req: Request, res: Response) => {
    return res.status(200).json(await twoFactorStatus(req.user!.id));
  };

  public static twoFactorSetup = async (req: Request, res: Response) => {
    // The app lists the account under the studio's name (or the platform's).
    const studio = req.user!.studioId
      ? await raw.studio.findUnique({
          where: { id: req.user!.studioId },
          select: { name: true },
        })
      : null;
    const result = await startTwoFactorSetup(
      req.user!.id,
      studio?.name ?? "Zuri",
    );
    return res.status(200).json(result);
  };

  public static twoFactorEnable = async (req: Request, res: Response) => {
    const result = await confirmTwoFactorSetup(req.user!.id, req.body?.code);
    return res.status(200).json(result);
  };

  public static twoFactorDisable = async (req: Request, res: Response) => {
    const result = await disableTwoFactor(
      req.user!.id,
      req.body?.password,
      req.body?.code,
    );
    return res.status(200).json(result);
  };

  public static twoFactorRecoveryCodes = async (
    req: Request,
    res: Response,
  ) => {
    const result = await regenerateRecoveryCodes(req.user!.id, req.body?.code);
    return res.status(200).json(result);
  };
}
