import { Request, Response, NextFunction } from "express";
import { AppointmentService } from "./appointmentService";
import { ApiError } from "../middleware/apiError";
import { errorMessage } from "../utils/helper";
import { validateCreateAppointment, validateUpdateStatus } from "./validator";

const appointmentService = new AppointmentService();

export class AppointmentController {
  public static create = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const isValid = validateCreateAppointment(req.body);
      if (!isValid) {
        return res.status(400).json({
          message: errorMessage(validateCreateAppointment.errors),
          errors: validateCreateAppointment.errors,
        });
      }
      // optionalAuth populates req.user for logged-in bookings; guests allowed.
      const userId = req.user?.id;
      const result = await appointmentService.create(
        req.body,
        userId,
        req.file,
      );
      return res.status(201).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static availability = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const date = String(req.query.date || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new ApiError("A valid date (yyyy-MM-dd) is required", 400);
      }
      const result = await appointmentService.takenSlots(date);
      return res.status(200).json(result);
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
      if (!req.user) throw new ApiError("Authentication required", 401);
      const result = await appointmentService.listForUser(req.user.id);
      return res.status(200).json(result);
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
      const result = await appointmentService.listAll();
      return res.status(200).json(result);
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
      if (!id) throw new ApiError("Appointment ID is required", 400);
      const isValid = validateUpdateStatus(req.body);
      if (!isValid) {
        return res.status(400).json({
          message: errorMessage(validateUpdateStatus.errors),
          errors: validateUpdateStatus.errors,
        });
      }
      const result = await appointmentService.updateStatus(id, req.body.status);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static remove = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      if (!id) throw new ApiError("Appointment ID is required", 400);
      const result = await appointmentService.remove(id);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };
}
