import { Request, Response } from "express";
import { AppointmentService } from "./appointmentService";
import { ApiError } from "../middleware/apiError";
import { validateCreateAppointment, validateUpdateStatus } from "./validator";
import { parseCursorPage } from "../utils/cursorPagination";
import { assertValid } from "../utils/validation";

const appointmentService = new AppointmentService();

export class AppointmentController {
  public static create = async (req: Request, res: Response) => {
    assertValid(validateCreateAppointment, req.body);
    // optionalAuth populates req.user for logged-in bookings; guests allowed.
    const userId = req.user?.id;
    const result = await appointmentService.create(req.body, userId);
    return res.status(201).json(result);
  };

  public static availability = async (req: Request, res: Response) => {
    const date = String(req.query.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new ApiError("A valid date (yyyy-MM-dd) is required", 400);
    }
    const result = await appointmentService.takenSlots(date);
    return res.status(200).json(result);
  };

  public static listMine = async (req: Request, res: Response) => {
    if (!req.user) throw new ApiError("Authentication required", 401);
    const page = parseCursorPage(req.query.cursor, req.query.limit);
    const result = await appointmentService.listForUser(req.user.id, page);
    return res.status(200).json(result);
  };

  public static listAll = async (req: Request, res: Response) => {
    const page = parseCursorPage(req.query.cursor, req.query.limit);
    const result = await appointmentService.listAll(page);
    return res.status(200).json(result);
  };

  // Body validation lives in the service here, not in an AJV schema, because
  // the slot rules (clash, terminal status, same-slot) need the existing row.
  public static reschedule = async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw new ApiError("Appointment ID is required", 400);
    // One service method, two actors. The role comes from the authenticated
    // session, never from the body, so a customer cannot claim admin rules.
    const isAdmin =
      req.user?.role === "ADMIN" || req.user?.role === "SUPER_ADMIN";
    const result = await appointmentService.reschedule(
      id,
      {
        date: req.body?.date,
        time: req.body?.time,
        reason: req.body?.reason,
      },
      isAdmin
        ? { role: "ADMIN" }
        : {
            role: "CUSTOMER",
            ...(req.user?.id ? { userId: req.user.id } : {}),
          },
    );
    return res.status(200).json(result);
  };

  // Admin-only: changing the service moves money, so it is not something a
  // customer can do to their own booking yet (see changeService's doc comment).
  public static changeService = async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw new ApiError("Appointment ID is required", 400);
    const serviceId =
      typeof req.body?.serviceId === "string" ? req.body.serviceId.trim() : "";
    if (!serviceId) throw new ApiError("A service id is required", 400);
    const result = await appointmentService.changeService(id, serviceId, {
      ...(req.user?.email ? { email: req.user.email } : {}),
      ...(req.user?.role ? { role: req.user.role } : {}),
    });
    return res.status(200).json(result);
  };

  public static updateStatus = async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw new ApiError("Appointment ID is required", 400);
    assertValid(validateUpdateStatus, req.body);
    const result = await appointmentService.updateStatus(id, req.body.status);
    return res.status(200).json(result);
  };

  public static remove = async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw new ApiError("Appointment ID is required", 400);
    const result = await appointmentService.remove(id);
    return res.status(200).json(result);
  };
}
