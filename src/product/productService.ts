import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import { S3BucketService } from "../bucket/s3BucketService";
import { CursorPage, cursorPageArgs, cursorPageResult } from "../utils/cursorPagination";

export interface CreateProductInput {
  name: string;
  description?: string | null;
  price: number;
  costPrice?: number;
  promoPrice?: number | null;
  category: string;
  stock?: number;
  trackStock?: boolean;
  active?: boolean;
  popular?: boolean;
  imageUrl?: string | null;
}

export type UpdateProductInput = Partial<CreateProductInput>;

export class ProductService extends Connection {
  private s3 = new S3BucketService();

  private async assertCategoryExists(slug: string) {
    const category = await this.productCategory.findFirst({ where: { slug } });
    if (!category) {
      throw new ApiError("Selected product category does not exist", 400);
    }
  }

  // Public list: active products whose category is also visible (active).
  public async listActive(page: CursorPage) {
    const visible = await this.productCategory.findMany({
      where: { active: true },
      select: { slug: true },
    });
    const slugs = visible.map((c) => c.slug);
    const products = await this.product.findMany({
      where: { active: true, category: { in: slugs } },
      orderBy: [{ category: "asc" }, { name: "asc" }, { id: "asc" }],
      ...cursorPageArgs(page),
    });
    products.forEach((item) => { item.imageUrl = this.s3.deliveryUrl(item.imageUrl); });
    return { message: "Products retrieved successfully", ...cursorPageResult(products, page) };
  }

  public async listAll(page: CursorPage) {
    const products = await this.product.findMany({
      orderBy: [{ category: "asc" }, { name: "asc" }, { id: "asc" }],
      ...cursorPageArgs(page),
    });
    products.forEach((item) => { item.imageUrl = this.s3.deliveryUrl(item.imageUrl); });
    return { message: "Products retrieved successfully", ...cursorPageResult(products, page) };
  }

  public async getById(id: string) {
    const product = await this.product.findUnique({ where: { id } });
    if (!product) throw new ApiError("Product not found", 404);
    product.imageUrl = this.s3.deliveryUrl(product.imageUrl);
    return { message: "Product retrieved successfully", data: product };
  }

  public async create(data: CreateProductInput) {
    await this.assertCategoryExists(data.category);
    if (!data.name?.trim()) throw new ApiError("Product name is required", 400);
    if (!(data.price >= 0)) throw new ApiError("A valid price is required", 400);

    const imageUrl = data.imageUrl ? this.s3.assertOwnedMediaUrl(data.imageUrl, "products") : undefined;

    const product = await this.product.create({
      data: {
        name: data.name.trim(),
        description: data.description ?? null,
        price: data.price,
        costPrice: data.costPrice ?? 0,
        promoPrice: data.promoPrice ?? null,
        category: data.category,
        stock: data.stock ?? 0,
        trackStock: data.trackStock ?? true,
        active: data.active ?? true,
        popular: data.popular ?? false,
        ...(imageUrl ? { imageUrl } : {}),
      },
    });
    return { message: "Product created successfully", data: product };
  }

  public async update(
    id: string,
    data: UpdateProductInput,
  ) {
    const existing = await this.product.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Product not found", 404);
    if (data.category !== undefined) {
      await this.assertCategoryExists(data.category);
    }

    const imageUrl = data.imageUrl ? this.s3.assertOwnedMediaUrl(data.imageUrl, "products") : undefined;

    const product = await this.product.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.price !== undefined ? { price: data.price } : {}),
        ...(data.costPrice !== undefined ? { costPrice: data.costPrice } : {}),
        ...(data.promoPrice !== undefined ? { promoPrice: data.promoPrice } : {}),
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(data.stock !== undefined ? { stock: data.stock } : {}),
        ...(data.trackStock !== undefined ? { trackStock: data.trackStock } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
        ...(data.popular !== undefined ? { popular: data.popular } : {}),
        ...(imageUrl ? { imageUrl } : {}),
      },
    });
    return { message: "Product updated successfully", data: product };
  }

  public async remove(id: string) {
    const existing = await this.product.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Product not found", 404);
    await this.product.delete({ where: { id } });
    return { message: "Product deleted successfully" };
  }
}
