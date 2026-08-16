import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";

export interface CreateCategoryInput {
  name: string;
}

export interface UpdateCategoryInput {
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

export class CategoryService extends Connection {
  public async listActive() {
    const categories = await this.category.findMany({
      where: { active: true },
      orderBy: [{ order: "asc" }, { name: "asc" }],
    });
    return { message: "Categories retrieved successfully", data: categories };
  }

  public async listAll() {
    const categories = await this.category.findMany({
      orderBy: [{ order: "asc" }, { name: "asc" }],
    });
    return { message: "Categories retrieved successfully", data: categories };
  }

  public async create(data: CreateCategoryInput) {
    const base = slugify(data.name);
    if (!base) {
      throw new ApiError("Category name must contain letters or numbers", 400);
    }

    // Ensure a unique slug (append -2, -3, … on collision).
    let slug = base;
    let n = 2;
    while (await this.category.findFirst({ where: { slug } })) {
      slug = `${base}-${n++}`;
    }

    const max = await this.category.aggregate({ _max: { order: true } });
    const category = await this.category.create({
      data: {
        name: data.name.trim(),
        slug,
        order: (max._max.order ?? -1) + 1,
      },
    });
    return { message: "Category created successfully", data: category };
  }

  public async update(id: string, data: UpdateCategoryInput) {
    const existing = await this.category.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError("Category not found", 404);
    }
    // Slug stays stable so existing services/gallery keep matching.
    const category = await this.category.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
        ...(data.order !== undefined ? { order: data.order } : {}),
      },
    });
    return { message: "Category updated successfully", data: category };
  }

  public async remove(id: string) {
    const existing = await this.category.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError("Category not found", 404);
    }

    const [serviceCount, galleryCount] = await Promise.all([
      this.service.count({ where: { category: existing.slug } }),
      this.gallery.count({ where: { category: existing.slug } }),
    ]);
    if (serviceCount > 0 || galleryCount > 0) {
      throw new ApiError(
        `Category is in use by ${serviceCount} service(s) and ${galleryCount} gallery item(s). Reassign or remove them first.`,
        409,
      );
    }

    await this.category.delete({ where: { id } });
    return { message: "Category deleted successfully" };
  }

  // Used by service/gallery creation to validate a category slug exists.
  public async slugExists(slug: string): Promise<boolean> {
    const c = await this.category.findFirst({ where: { slug } });
    return !!c;
  }
}
