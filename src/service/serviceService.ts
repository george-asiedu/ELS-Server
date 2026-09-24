import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import { CreateServiceInput, UpdateServiceInput } from "./serviceModels";
import { S3BucketService } from "../bucket/s3BucketService";
import { CursorPage, cursorPageArgs, cursorPageResult } from "../utils/cursorPagination";

export class ServiceService extends Connection {
  private s3 = new S3BucketService();
  // Public list: active services whose category is also visible (active).
  public async listActive(page: CursorPage) {
    const visible = await this.category.findMany({
      where: { active: true },
      select: { slug: true },
    });
    const slugs = visible.map((c) => c.slug);
    const services = await this.service.findMany({
      where: { active: true, category: { in: slugs } },
      orderBy: [{ category: "asc" }, { name: "asc" }, { id: "asc" }],
      ...cursorPageArgs(page),
    });
    services.forEach((item) => { item.imageUrl = this.s3.deliveryUrl(item.imageUrl); });
    return { message: "Services retrieved successfully", ...cursorPageResult(services, page) };
  }

  private async assertCategoryExists(slug: string) {
    const category = await this.category.findFirst({ where: { slug } });
    if (!category) {
      throw new ApiError("Selected category does not exist", 400);
    }
  }

  public async listAll(page: CursorPage) {
    const services = await this.service.findMany({
      orderBy: [{ category: "asc" }, { name: "asc" }, { id: "asc" }],
      ...cursorPageArgs(page),
    });
    services.forEach((item) => { item.imageUrl = this.s3.deliveryUrl(item.imageUrl); });
    return { message: "Services retrieved successfully", ...cursorPageResult(services, page) };
  }

  public async getById(id: string) {
    const service = await this.service.findUnique({ where: { id } });
    if (!service) {
      throw new ApiError("Service not found", 404);
    }
    service.imageUrl = this.s3.deliveryUrl(service.imageUrl);
    return { message: "Service retrieved successfully", data: service };
  }

  public async create(data: CreateServiceInput) {
    await this.assertCategoryExists(data.category);
    const imageUrl = data.imageUrl ? this.s3.assertOwnedMediaUrl(data.imageUrl, "services") : undefined;
    const service = await this.service.create({
      data: {
        name: data.name,
        category: data.category,
        description: data.description ?? null,
        price: data.price,
        promoPrice: data.promoPrice ?? null,
        duration: data.duration,
        popular: data.popular ?? false,
        active: data.active ?? true,
        imageUrl: imageUrl ?? null,
      },
    });
    return { message: "Service created successfully", data: service };
  }

  public async update(id: string, data: UpdateServiceInput) {
    const existing = await this.service.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError("Service not found", 404);
    }
    if (data.category !== undefined) {
      await this.assertCategoryExists(data.category);
    }
    const imageUrl = data.imageUrl ? this.s3.assertOwnedMediaUrl(data.imageUrl, "services") : data.imageUrl;

    const service = await this.service.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.price !== undefined ? { price: data.price } : {}),
        ...(data.promoPrice !== undefined ? { promoPrice: data.promoPrice } : {}),
        ...(data.duration !== undefined ? { duration: data.duration } : {}),
        ...(data.popular !== undefined ? { popular: data.popular } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
        ...(imageUrl !== undefined ? { imageUrl } : {}),
      },
    });
    return { message: "Service updated successfully", data: service };
  }

  public async remove(id: string) {
    const existing = await this.service.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError("Service not found", 404);
    }
    await this.service.delete({ where: { id } });
    return { message: "Service deleted successfully" };
  }
}
