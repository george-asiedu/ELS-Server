import { Request, Response } from "express";
import { CartService } from "./cartService";
import { ApiError } from "../middleware/apiError";

const cartService = new CartService();
const text = (v: unknown) => (typeof v === "string" ? v : "");

export class CartController {
  public static getMine = async (req: Request, res: Response) => {
    return res.status(200).json(await cartService.getMine(req.user.id));
  };

  public static addItem = async (req: Request, res: Response) => {
    const { productId, quantity, size, color } = req.body ?? {};
    if (!productId) throw new ApiError("productId is required", 400);
    const result = await cartService.addItem(
      req.user.id,
      productId,
      Number(quantity ?? 1),
      text(size),
      text(color),
    );
    return res.status(200).json(result);
  };

  public static updateItem = async (req: Request, res: Response) => {
    const { productId, quantity, size, color } = req.body ?? {};
    if (!productId) throw new ApiError("productId is required", 400);
    if (quantity === undefined) throw new ApiError("quantity is required", 400);
    const result = await cartService.updateItem(
      req.user.id,
      productId,
      Number(quantity),
      text(size),
      text(color),
    );
    return res.status(200).json(result);
  };

  public static removeItem = async (req: Request, res: Response) => {
    const { productId } = req.params;
    if (!productId) throw new ApiError("productId is required", 400);
    return res
      .status(200)
      .json(
        await cartService.removeItem(
          req.user.id,
          productId,
          text(req.query.size),
          text(req.query.color),
        ),
      );
  };

  public static clear = async (req: Request, res: Response) => {
    return res.status(200).json(await cartService.clear(req.user.id));
  };
}
