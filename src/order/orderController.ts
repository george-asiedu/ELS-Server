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
      const {
        fulfillment,
        deliveryAddress,
        deliveryPhone,
        applyPoints,
        referralCode,
      } = req.body ?? {};
      const result = await orderService.checkout(req.user.id, {
        fulfillment: fulfillment === "DELIVERY" ? "DELIVERY" : "PICKUP",
        deliveryAddress,
        deliveryPhone,
        applyPoints: applyPoints === true || applyPoints === "true",
        referralCode,
      });
      return res.status(201).json(result);
    } catch (error) {
      return next(error);
    }
  };

  // Public — a guest buys one or more products without an account.
  public static guestCheckout = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const {
        items,
        name,
        email,
        phone,
        fulfillment,
        deliveryAddress,
        deliveryPhone,
        referralCode,
      } = req.body ?? {};
      if (!Array.isArray(items) || items.length === 0) {
        throw new ApiError("At least one product is required", 400);
      }
      const result = await orderService.guestCheckout({
        items,
        name,
        email,
        phone,
        fulfillment: fulfillment === "DELIVERY" ? "DELIVERY" : "PICKUP",
        deliveryAddress,
        deliveryPhone,
        referralCode,
      });
      return res.status(201).json(result);
    } catch (error) {
      return next(error);
    }
  };

  // Customer — pay for products added to a booking (combined with the service).
  public static bookingCheckout = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { appointmentId, items, serviceType, referralCode } = req.body ?? {};
      if (!appointmentId) throw new ApiError("appointmentId is required", 400);
      if (!Array.isArray(items) || items.length === 0) {
        throw new ApiError("At least one product is required", 400);
      }
      const result = await orderService.bookingCheckout(req.user.id, {
        appointmentId,
        items,
        serviceType: serviceType === "PARTIAL" ? "PARTIAL" : "FULL",
        referralCode,
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
