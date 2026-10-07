import { Request, Response } from "express";
import { AccountService } from "./accountService";
import { ApiError } from "../middleware/apiError";

const accountService = new AccountService();

export class AccountController {
  public static loyalty = async (req: Request, res: Response) => {
    if (!req.user) throw new ApiError("Authentication required", 401);
    const result = await accountService.getLoyalty(req.user.id);
    return res.status(200).json(result);
  };

  public static transactions = async (req: Request, res: Response) => {
    if (!req.user) throw new ApiError("Authentication required", 401);
    const result = await accountService.getTransactions(req.user.id);
    return res.status(200).json(result);
  };

  public static redeem = async (req: Request, res: Response) => {
    if (!req.user) throw new ApiError("Authentication required", 401);
    const points = Number(req.body?.points);
    const result = await accountService.redeem(req.user.id, points);
    return res.status(200).json(result);
  };

  public static referral = async (req: Request, res: Response) => {
    if (!req.user) throw new ApiError("Authentication required", 401);
    const result = await accountService.getReferral(req.user.id);
    return res.status(200).json(result);
  };
}
