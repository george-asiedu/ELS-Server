import { Request, Response } from "express";
import { BusinessHoursService } from "./businessHoursService";
import { ApiError } from "../middleware/apiError";

const businessHoursService = new BusinessHoursService();

export class BusinessHoursController {
  public static list = async (_req: Request, res: Response) => {
    const result = await businessHoursService.list();
    return res.status(200).json(result);
  };

  public static update = async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw new ApiError("Business hours ID is required", 400);
    const result = await businessHoursService.update(id, req.body);
    return res.status(200).json(result);
  };
}
