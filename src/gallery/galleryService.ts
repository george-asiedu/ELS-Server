import { Connection } from "../db/dbConnection";
import { S3BucketService } from "../bucket/s3BucketService";
import { ApiError } from "../middleware/apiError";
import { UploadedFile } from "../models/user";

type GalleryCategoryInput = "NAILS" | "LASHES" | "HAIR";

export class GalleryService extends Connection {
  constructor(private s3: S3BucketService) {
    super();
  }

  public async listActive() {
    const images = await this.gallery.findMany({
      where: { active: true },
      orderBy: { createdAt: "desc" },
    });
    return { message: "Gallery retrieved successfully", data: images };
  }

  public async listAll() {
    const images = await this.gallery.findMany({
      orderBy: { createdAt: "desc" },
    });
    return { message: "Gallery retrieved successfully", data: images };
  }

  public async create(
    title: string | undefined,
    category: GalleryCategoryInput,
    image?: UploadedFile,
  ) {
    if (!image) {
      throw new ApiError("An image file is required", 400);
    }
    const imageUrl = await this.s3.uploadFile(image);
    const created = await this.gallery.create({
      data: {
        ...(title ? { title } : {}),
        category,
        imageUrl,
      },
    });
    return { message: "Image uploaded successfully", data: created };
  }

  public async remove(id: string) {
    const existing = await this.gallery.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError("Image not found", 404);
    }
    await this.gallery.delete({ where: { id } });
    return { message: "Image deleted successfully" };
  }
}
