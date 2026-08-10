import { Request, Response, NextFunction } from "express";
import { OrderService } from "./orderService";
import { ApiError } from "../middleware/apiError";

const orderService = new OrderService();

export class OrderController {
  public static checkout = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { fulfillment, deliveryAddress, deliveryPhone } = req.body ?? {};
      const result = await orderService.checkout(req.user.id, {
        fulfillment: fulfillment === "DELIVERY" ? "DELIVERY" : "PICKUP",
        deliveryAddress,
        deliveryPhone,
      });
      return res.status(201).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static listMine = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      return res.status(200).json(await orderService.listMine(req.user.id));
    } catch (error) {
      return next(error);
    }
  };

  public static verify = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const reference = String(req.query.reference || "");
      if (!reference) throw new ApiError("reference is required", 400);
      return res.status(200).json(await orderService.verify(reference));
    } catch (error) {
      return next(error);
    }
  };

  public static listAll = async (
    _req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      return res.status(200).json(await orderService.listAll());
    } catch (error) {
      return next(error);
    }
  };

  public static updateStatus = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      if (!id) throw new ApiError("Order ID is required", 400);
      const { status } = req.body ?? {};
      if (!status) throw new ApiError("status is required", 400);
      return res.status(200).json(await orderService.updateStatus(id, status));
    } catch (error) {
      return next(error);
    }
  };
}
