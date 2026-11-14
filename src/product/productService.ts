import { PAID_ORDER_STATUSES } from "../order/orderStatus";
import { resetStockAlert } from "./stockAlerts";
import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import { S3BucketService } from "../bucket/s3BucketService";
import {
  CursorPage,
  cursorPageArgs,
  cursorPageResult,
} from "../utils/cursorPagination";

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
  images?: string[];
  sizes?: string[];
  colors?: string[];
  audience?: string;
  brand?: string | null;
  attributes?: string[];
}

export type UpdateProductInput = Partial<CreateProductInput>;

export class ProductService extends Connection {
  private s3 = new S3BucketService();

  // Display form of a product's photos, and its approved reviews' rating.
  private async present<
    T extends { id: string; imageUrl: string | null; images: string[] },
  >(products: T[]) {
    const stats = await this.review.groupBy({
      by: ["productId"],
      where: { productId: { in: products.map((p) => p.id) }, approved: true },
      _avg: { rating: true },
      _count: { _all: true },
    });
    const byId = new Map(stats.map((r) => [r.productId, r]));
    return products.map((p) => {
      const r = byId.get(p.id);
      return {
        ...p,
        imageUrl: this.s3.deliveryUrl(p.imageUrl),
        images: p.images.map((u) => this.s3.deliveryUrl(u) ?? u),
        ratingAverage: r?._avg.rating ?? null,
        ratingCount: r?._count._all ?? 0,
      };
    });
  }

  private cleanList(values: string[] | undefined) {
    return values === undefined
      ? undefined
      : [...new Set(values.map((v) => String(v).trim()).filter(Boolean))].slice(
          0,
          30,
        );
  }

  private options(data: UpdateProductInput) {
    const sizes = this.cleanList(data.sizes);
    const colors = this.cleanList(data.colors);
    if (colors?.some((c) => !/^[^|]{1,40}\|#[0-9a-fA-F]{6}$/.test(c))) {
      throw new ApiError("Each colour needs a name and a colour value", 400);
    }
    const attributes = this.cleanList(data.attributes);
    if (attributes?.some((a) => !/^[^|]{1,30}\|[^|]{1,60}$/.test(a))) {
      throw new ApiError("Each detail needs a label and a value", 400);
    }
    if (
      data.audience !== undefined &&
      !["MEN", "WOMEN", "UNISEX"].includes(data.audience)
    ) {
      throw new ApiError("Choose who it's for: men, women or everyone", 400);
    }
    const images = this.cleanList(data.images)?.map((u) =>
      this.s3.assertOwnedMediaUrl(u, "products"),
    );
    return {
      ...(sizes ? { sizes } : {}),
      ...(colors ? { colors } : {}),
      ...(attributes ? { attributes: attributes.slice(0, 12) } : {}),
      ...(data.audience !== undefined ? { audience: data.audience } : {}),
      ...(data.brand !== undefined ? { brand: data.brand } : {}),
      ...(images ? { images: images.slice(0, 8) } : {}),
    };
  }

  /** Approved reviews of one product, newest first. */
  public async listReviews(productId: string) {
    const data = await this.review.findMany({
      where: { productId, approved: true },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        rating: true,
        content: true,
        createdAt: true,
        user: { select: { profile: { select: { fullName: true } } } },
      },
    });
    return { message: "Reviews retrieved successfully", data };
  }

  /** Only someone who bought it can review it, once. Goes to the owner first. */
  public async addReview(
    userId: string,
    productId: string,
    rating: number,
    content: unknown,
  ) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new ApiError("Choose a rating from 1 to 5 stars", 400);
    }
    const bought = await this.orderItem.findFirst({
      where: {
        productId,
        order: { userId, status: { in: [...PAID_ORDER_STATUSES] } },
      },
      select: { id: true },
    });
    if (!bought) {
      throw new ApiError("You can review products you've bought", 403);
    }
    if (await this.review.findFirst({ where: { userId, productId } })) {
      throw new ApiError("You've already reviewed this product", 409);
    }
    const text =
      typeof content === "string" ? content.trim().slice(0, 1000) : "";
    await this.review.create({
      data: { userId, productId, rating, ...(text ? { content: text } : {}) },
    });
    return { message: "Thank you. Your review will appear once it's approved." };
  }

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
    const paged = cursorPageResult(products, page);
    return {
      message: "Products retrieved successfully",
      ...paged,
      data: await this.present(paged.data),
    };
  }

  public async listAll(page: CursorPage) {
    const products = await this.product.findMany({
      orderBy: [{ category: "asc" }, { name: "asc" }, { id: "asc" }],
      ...cursorPageArgs(page),
    });
    const paged = cursorPageResult(products, page);
    return {
      message: "Products retrieved successfully",
      ...paged,
      data: await this.present(paged.data),
    };
  }

  public async getById(id: string) {
    const product = await this.product.findUnique({ where: { id } });
    if (!product) throw new ApiError("Product not found", 404);
    const [data] = await this.present([product]);
    return { message: "Product retrieved successfully", data };
  }

  public async create(data: CreateProductInput) {
    await this.assertCategoryExists(data.category);
    if (!data.name?.trim()) throw new ApiError("Product name is required", 400);
    if (!(data.price >= 0))
      throw new ApiError("A valid price is required", 400);

    const imageUrl = data.imageUrl
      ? this.s3.assertOwnedMediaUrl(data.imageUrl, "products")
      : undefined;

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
        ...this.options(data),
      },
    });
    return { message: "Product created successfully", data: product };
  }

  public async update(id: string, data: UpdateProductInput) {
    const existing = await this.product.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Product not found", 404);
    if (data.category !== undefined) {
      await this.assertCategoryExists(data.category);
    }

    const imageUrl = data.imageUrl
      ? this.s3.assertOwnedMediaUrl(data.imageUrl, "products")
      : undefined;

    const product = await this.product.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.price !== undefined ? { price: data.price } : {}),
        ...(data.costPrice !== undefined ? { costPrice: data.costPrice } : {}),
        ...(data.promoPrice !== undefined
          ? { promoPrice: data.promoPrice }
          : {}),
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(data.stock !== undefined ? { stock: data.stock } : {}),
        ...(data.trackStock !== undefined
          ? { trackStock: data.trackStock }
          : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
        ...(data.popular !== undefined ? { popular: data.popular } : {}),
        ...(imageUrl ? { imageUrl } : {}),
        ...this.options(data),
      },
    });
    if (data.stock !== undefined) await resetStockAlert(id);
    return { message: "Product updated successfully", data: product };
  }

  public async remove(id: string) {
    const existing = await this.product.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Product not found", 404);
    await this.product.delete({ where: { id } });
    return { message: "Product deleted successfully" };
  }
}
