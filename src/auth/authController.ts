import { Request, Response } from "express";
import { AuthService } from "./authService";
import { validateSignup } from "./validators/signup";
import { validateLogin } from "./validators/login";
import { ApiError } from "../middleware/apiError";
import { validateEmail, validatePassword } from "../profile/validator/profile";
import { revokeLoginSession } from "./sessionService";
import { getLoginDeviceMetadata } from "./loginDevice";
import { assertValid } from "../utils/validation";

const authService = new AuthService();

export class AuthController {
  public static logout = async (req: Request, res: Response) => {
    if (req.user && req.authSessionId) {
      await revokeLoginSession(req.authSessionId, req.user.id);
    }
    return res.status(200).json({ message: "Logged out successfully" });
  };

  public static signup = async (
    req: Request,
    res: Response,
  ) => {
    assertValid(validateSignup, req.body);
    const result = await authService.signup(req.body, getLoginDeviceMetadata(req));
    return res.status(201).json(result);
  };

  public static login = async (
    req: Request,
    res: Response,
  ) => {
    assertValid(validateLogin, req.body);
    const result = await authService.login(req.body, getLoginDeviceMetadata(req));
    return res.status(200).json(result);
  };
  
  public static forgotPassword = async (
     req: Request,
     res: Response,
  ) => {
    assertValid(validateEmail, req.body);
    
    const result = await authService.forgotPassword(req.body.email);
    return res.status(200).json(result);
  };
  
  public static resetPassword = async (
    req: Request,
    res: Response,
  ) => {
    assertValid(validatePassword, req.body);

    const { token } = req.params;
    if (!token) {
      throw new ApiError("Token is required", 400);
    }
    const result = await authService.resetPassword(token, req.body.password);
    return res.status(200).json(result);
  };
}
