import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";

export interface UpdateBusinessHoursInput {
  openTime?: string | null;
  closeTime?: string | null;
  isClosed?: boolean;
}

// Mon–Fri 09:00–18:00, Sat 10:00–16:00, Sun closed.
const DEFAULT_HOURS = [
  { dayOfWeek: 0, openTime: null, closeTime: null, isClosed: true },
  { dayOfWeek: 1, openTime: "09:00", closeTime: "18:00", isClosed: false },
  { dayOfWeek: 2, openTime: "09:00", closeTime: "18:00", isClosed: false },
  { dayOfWeek: 3, openTime: "09:00", closeTime: "18:00", isClosed: false },
  { dayOfWeek: 4, openTime: "09:00", closeTime: "18:00", isClosed: false },
  { dayOfWeek: 5, openTime: "09:00", closeTime: "18:00", isClosed: false },
  { dayOfWeek: 6, openTime: "10:00", closeTime: "16:00", isClosed: false },
];

export class BusinessHoursService extends Connection {
  public async list() {
    let hours = await this.businessHours.findMany({
      orderBy: { dayOfWeek: "asc" },
    });

    // Lazily seed the weekly schedule the first time it's requested.
    if (hours.length === 0) {
      await this.businessHours.createMany({ data: DEFAULT_HOURS });
      hours = await this.businessHours.findMany({
        orderBy: { dayOfWeek: "asc" },
      });
    }

    return { message: "Business hours retrieved successfully", data: hours };
  }

  public async update(id: string, data: UpdateBusinessHoursInput) {
    const existing = await this.businessHours.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError("Business hours entry not found", 404);
    }
    const updated = await this.businessHours.update({
      where: { id },
      data: {
        ...(data.openTime !== undefined ? { openTime: data.openTime } : {}),
        ...(data.closeTime !== undefined ? { closeTime: data.closeTime } : {}),
        ...(data.isClosed !== undefined ? { isClosed: data.isClosed } : {}),
      },
    });
    return { message: "Business hours updated", data: updated };
  }
}
