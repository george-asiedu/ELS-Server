import { Request, Response, NextFunction } from "express";
import { AuthService } from "./authService";
import { validateSignup } from "./validators/signup";
import { errorMessage } from "../utils/helper";
import { validateLogin } from "./validators/login";

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
}
