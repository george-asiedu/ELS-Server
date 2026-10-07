import { Request, Response } from "express";
import { GalleryService } from "./galleryService";
import { S3BucketService } from "../bucket/s3BucketService";
import { ApiError } from "../middleware/apiError";
import { parseCursorPage } from "../utils/cursorPagination";

const s3 = new S3BucketService();
const galleryService = new GalleryService(s3);

export class GalleryController {
  public static list = async (
    req: Request,
    res: Response,
  ) => {
    const page = parseCursorPage(req.query.cursor, req.query.limit);
    const result = await galleryService.listActive(page);
    return res.status(200).json(result);
  };

  public static listAll = async (
    req: Request,
    res: Response,
  ) => {
    const page = parseCursorPage(req.query.cursor, req.query.limit);
    const result = await galleryService.listAll(page);
    return res.status(200).json(result);
  };

  public static create = async (
    req: Request,
    res: Response,
  ) => {
    const { title, category, imageUrl, externalUrl } = req.body as {
      title?: string;
      category?: string;
      imageUrl?: string;
      externalUrl?: string;
    };
    if (!category) {
      throw new ApiError("A category is required", 400);
    }
    const result = await galleryService.create(title, category, imageUrl, externalUrl);
    return res.status(201).json(result);
  };

  public static remove = async (
    req: Request,
    res: Response,
  ) => {
    const { id } = req.params;
    if (!id) throw new ApiError("Image ID is required", 400);
    const result = await galleryService.remove(id);
    return res.status(200).json(result);
  };
}
