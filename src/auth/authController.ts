import { Request, Response, NextFunction } from "express";
import { AuthService } from "./authService";
import { validateSignup } from "./validators/signup";
import { errorMessage } from "../utils/helper";
import { validateLogin } from "./validators/login";
import { ApiError } from "../middleware/apiError";
import { validateEmail, validatePassword } from "../profile/validator/profile";

const authService = new AuthService();

export class AuthController {
  public static signup = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const isValid = validateSignup(req.body);
      if (!isValid) {
        return res.status(400).json({
          message: errorMessage(validateSignup.errors),
          errors: validateSignup.errors,
        });
      }
      const result = await authService.signup(req.body);
      return res.status(201).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static login = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const isValid = validateLogin(req.body);
      if (!isValid) {
        return res.status(400).json({
          message: errorMessage(validateLogin.errors),
          errors: validateLogin.errors,
        });
      }
      const result = await authService.login(req.body);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };
  
  public static forgotPassword = async (
     req: Request,
     res: Response,
     next: NextFunction,
  ) => {
    try {
      const isValid = validateEmail(req.body);
      if (!isValid) {
        return res.status(400).json({
          message: errorMessage(validateEmail.errors),
          errors: validateEmail.errors,
        });
      }
      
      const result = await authService.forgotPassword(req.body.email);
      return res.status(200).json(result);
     } catch (error) {
       return next(error);
    }
  };
  
  public static resetPassword = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const isValid = validatePassword(req.body);
      if (!isValid) {
        return res.status(400).json({
          message: errorMessage(validatePassword.errors),
          errors: validatePassword.errors,
        });
      }

      const { token } = req.params;
      if (!token) {
        throw new ApiError("Token is required", 400);
      }
      const result = await authService.resetPassword(token, req.body.password);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };
}
