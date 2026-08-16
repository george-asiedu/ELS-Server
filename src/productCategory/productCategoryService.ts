import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";

export interface CreateProductCategoryInput {
  name: string;
}

export interface UpdateProductCategoryInput {
  name?: string;
  active?: boolean;
  order?: number;
}

const slugify = (name: string): string =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export class ProductCategoryService extends Connection {
  public async listActive() {
    const categories = await this.productCategory.findMany({
      where: { active: true },
      orderBy: [{ order: "asc" }, { name: "asc" }],
    });
    return {
      message: "Product categories retrieved successfully",
      data: categories,
    };
  }

  public async listAll() {
    const categories = await this.productCategory.findMany({
      orderBy: [{ order: "asc" }, { name: "asc" }],
    });
    return {
      message: "Product categories retrieved successfully",
      data: categories,
    };
  }

  public async create(data: CreateProductCategoryInput) {
    const base = slugify(data.name);
    if (!base) {
      throw new ApiError("Category name must contain letters or numbers", 400);
    }

    let slug = base;
    let n = 2;
    while (await this.productCategory.findFirst({ where: { slug } })) {
      slug = `${base}-${n++}`;
    }

    const max = await this.productCategory.aggregate({ _max: { order: true } });
    const category = await this.productCategory.create({
      data: {
        name: data.name.trim(),
        slug,
        order: (max._max.order ?? -1) + 1,
      },
    });
    return { message: "Product category created successfully", data: category };
  }

  public async update(id: string, data: UpdateProductCategoryInput) {
    const existing = await this.productCategory.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError("Product category not found", 404);
    }
    // Slug stays stable so existing products keep matching.
    const category = await this.productCategory.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
        ...(data.order !== undefined ? { order: data.order } : {}),
      },
    });
    return { message: "Product category updated successfully", data: category };
  }

  public async remove(id: string) {
    const existing = await this.productCategory.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError("Product category not found", 404);
    }

    const productCount = await this.product.count({
      where: { category: existing.slug },
    });
    if (productCount > 0) {
      throw new ApiError(
        `Category is in use by ${productCount} product(s). Reassign or remove them first.`,
        409,
      );
    }

    await this.productCategory.delete({ where: { id } });
    return { message: "Product category deleted successfully" };
  }
}
