import { Request, Response, NextFunction } from "express";
import { CartService } from "./cartService";
import { ApiError } from "../middleware/apiError";

const cartService = new CartService();

export class CartController {
  public static getMine = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      return res.status(200).json(await cartService.getMine(req.user.id));
    } catch (error) {
      return next(error);
    }
  };

  public static addItem = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { productId, quantity } = req.body ?? {};
      if (!productId) throw new ApiError("productId is required", 400);
      const result = await cartService.addItem(
        req.user.id,
        productId,
        Number(quantity ?? 1),
      );
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static updateItem = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { productId, quantity } = req.body ?? {};
      if (!productId) throw new ApiError("productId is required", 400);
      if (quantity === undefined) throw new ApiError("quantity is required", 400);
      const result = await cartService.updateItem(
        req.user.id,
        productId,
        Number(quantity),
      );
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static removeItem = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { productId } = req.params;
      if (!productId) throw new ApiError("productId is required", 400);
      return res
        .status(200)
        .json(await cartService.removeItem(req.user.id, productId));
    } catch (error) {
      return next(error);
    }
  };

  public static clear = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      return res.status(200).json(await cartService.clear(req.user.id));
    } catch (error) {
      return next(error);
    }
  };
}
