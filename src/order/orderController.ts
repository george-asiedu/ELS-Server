import { Request, Response } from "express";
import { OrderService } from "./orderService";
import { parseCursorPage } from "../utils/cursorPagination";
import { ApiError } from "../middleware/apiError";

const orderService = new OrderService();

export class OrderController {
  public static checkout = async (req: Request, res: Response) => {
    const {
      fulfillment,
      deliveryAddress,
      deliveryPhone,
      applyPoints,
      referralCode,
    } = req.body ?? {};
    const result = await orderService.checkout(
      req.user.id,
      {
        fulfillment: fulfillment === "DELIVERY" ? "DELIVERY" : "PICKUP",
        deliveryAddress,
        deliveryPhone,
        applyPoints: applyPoints === true || applyPoints === "true",
        referralCode,
      },
      req.headers.origin,
    );
    return res.status(201).json(result);
  };

  // Public — a guest buys one or more products without an account.
  public static guestCheckout = async (req: Request, res: Response) => {
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
    const result = await orderService.guestCheckout(
      {
        items,
        name,
        email,
        phone,
        fulfillment: fulfillment === "DELIVERY" ? "DELIVERY" : "PICKUP",
        deliveryAddress,
        deliveryPhone,
        referralCode,
      },
      req.headers.origin,
    );
    return res.status(201).json(result);
  };

  // Customer — pay for products added to a booking (combined with the service).
  public static bookingCheckout = async (req: Request, res: Response) => {
    const { appointmentId, items, serviceType, referralCode } = req.body ?? {};
    if (!appointmentId) throw new ApiError("appointmentId is required", 400);
    if (!Array.isArray(items) || items.length === 0) {
      throw new ApiError("At least one product is required", 400);
    }
    const result = await orderService.bookingCheckout(
      req.user.id,
      {
        appointmentId,
        items,
        serviceType: serviceType === "PARTIAL" ? "PARTIAL" : "FULL",
        referralCode,
      },
      req.headers.origin,
    );
    return res.status(201).json(result);
  };

  public static listMine = async (req: Request, res: Response) => {
    const page = parseCursorPage(req.query.cursor, req.query.limit);
    return res.status(200).json(await orderService.listMine(req.user.id, page));
  };

  public static verify = async (req: Request, res: Response) => {
    const reference = String(req.query.reference || "");
    if (!reference) throw new ApiError("reference is required", 400);
    return res.status(200).json(await orderService.verify(reference));
  };

  public static repay = async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) throw new ApiError("Authentication required", 401);
    const { id } = req.params;
    if (!id) throw new ApiError("Order id is required", 400);
    return res
      .status(200)
      .json(await orderService.repay(userId, id, req.headers.origin));
  };

  public static listAll = async (req: Request, res: Response) => {
    const page = parseCursorPage(req.query.cursor, req.query.limit);
    return res.status(200).json(await orderService.listAll(page));
  };

  public static updateStatus = async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw new ApiError("Order ID is required", 400);
    const { status } = req.body ?? {};
    if (!status) throw new ApiError("status is required", 400);
    return res.status(200).json(await orderService.updateStatus(id, status));
  };
}
