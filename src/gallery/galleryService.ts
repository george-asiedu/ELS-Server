import { Connection } from "../db/dbConnection";
import { S3BucketService } from "../bucket/s3BucketService";
import { ApiError } from "../middleware/apiError";
import { UploadedFile } from "../models/user";

export class GalleryService extends Connection {
  constructor(private s3: S3BucketService) {
    super();
  }

  // Public: active items whose category is also visible (active).
  public async listActive() {
    const visible = await this.category.findMany({
      where: { active: true },
      select: { slug: true },
    });
    const slugs = visible.map((c) => c.slug);
    const images = await this.gallery.findMany({
      where: { active: true, category: { in: slugs } },
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
    category: string,
    file?: UploadedFile,
  ) {
    if (!file) {
      throw new ApiError("An image or video file is required", 400);
    }
    const categoryExists = await this.category.findFirst({
      where: { slug: category },
    });
    if (!categoryExists) {
      throw new ApiError("Selected category does not exist", 400);
    }
    const mediaType = file.mimetype.startsWith("video/") ? "VIDEO" : "IMAGE";
    const imageUrl = await this.s3.uploadFile(file);
    const created = await this.gallery.create({
      data: {
        ...(title ? { title } : {}),
        category,
        mediaType,
        imageUrl,
      },
    });
    const label = mediaType === "VIDEO" ? "Video" : "Image";
    return { message: `${label} uploaded successfully`, data: created };
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
