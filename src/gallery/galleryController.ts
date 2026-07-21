import { Request, Response, NextFunction } from "express";
import { GalleryService } from "./galleryService";
import { S3BucketService } from "../bucket/s3BucketService";
import { ApiError } from "../middleware/apiError";

const s3 = new S3BucketService();
const galleryService = new GalleryService(s3);

const VALID_CATEGORIES = ["NAILS", "LASHES", "HAIR"];

export class GalleryController {
  public static list = async (
    _req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await galleryService.listActive();
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
      const result = await galleryService.listAll();
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public static create = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { title, category } = req.body as {
        title?: string;
        category?: string;
      };
      if (!category || !VALID_CATEGORIES.includes(category)) {
        throw new ApiError("Category must be NAILS, LASHES or HAIR", 400);
      }
      const result = await galleryService.create(
        title,
        category as "NAILS" | "LASHES" | "HAIR",
        req.file,
      );
      return res.status(201).json(result);
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
      if (!id) throw new ApiError("Image ID is required", 400);
      const result = await galleryService.remove(id);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };
}
