import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import { CreateServiceInput, UpdateServiceInput } from "./serviceModels";

export class ServiceService extends Connection {
  public async listActive() {
    const services = await this.service.findMany({
      where: { active: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
    return { message: "Services retrieved successfully", data: services };
  }

  public async listAll() {
    const services = await this.service.findMany({
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
    return { message: "Services retrieved successfully", data: services };
  }

  public async getById(id: string) {
    const service = await this.service.findUnique({ where: { id } });
    if (!service) {
      throw new ApiError("Service not found", 404);
    }
    return { message: "Service retrieved successfully", data: service };
  }

  public async create(data: CreateServiceInput) {
    const service = await this.service.create({
      data: {
        name: data.name,
        category: data.category,
        description: data.description ?? null,
        price: data.price,
        duration: data.duration,
        popular: data.popular ?? false,
        active: data.active ?? true,
        imageUrl: data.imageUrl ?? null,
      },
    });
    return { message: "Service created successfully", data: service };
  }

  public async update(id: string, data: UpdateServiceInput) {
    const existing = await this.service.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError("Service not found", 404);
    }

    const service = await this.service.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.price !== undefined ? { price: data.price } : {}),
        ...(data.duration !== undefined ? { duration: data.duration } : {}),
        ...(data.popular !== undefined ? { popular: data.popular } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
        ...(data.imageUrl !== undefined ? { imageUrl: data.imageUrl } : {}),
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
