import { Request, Response } from "express";
import { FeatureRequestService } from "./featureRequestService";
import { ApiError } from "../middleware/apiError";
import { HttpCode } from "../models/status_codes";

const service = new FeatureRequestService();

export class FeatureRequestController {
  // ---- Studio side ------------------------------------------------------

  public static create = async (req: Request, res: Response) => {
    const result = await service.create(
      req.studioId,
      req.user?.id,
      req.body ?? {},
    );
    return res.status(201).json(result);
  };

  public static listMine = async (req: Request, res: Response) => {
    const result = await service.listForStudio(req.studioId);
    return res.status(200).json(result);
  };

  // ---- Platform (super-admin) side --------------------------------------

  public static platformList = async (req: Request, res: Response) => {
    const status =
      typeof req.query.status === "string" ? req.query.status : undefined;
    const result = await service.listAll(status);
    return res.status(200).json(result);
  };

  public static platformUpdateStatus = async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw new ApiError("Request id is required", HttpCode.BAD_REQUEST);
    const status = String(req.body?.status ?? "");
    const result = await service.updateStatus(id, status);
    return res.status(200).json(result);
  };
}
