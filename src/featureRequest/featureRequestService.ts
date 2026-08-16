import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import { HttpCode } from "../models/status_codes";

export const FEATURE_REQUEST_STATUSES = [
  "NEW",
  "PLANNED",
  "IN_PROGRESS",
  "DONE",
  "DECLINED",
] as const;

type FeatureRequestStatus = (typeof FEATURE_REQUEST_STATUSES)[number];

/**
 * Feature requests a studio sends to the platform operator. FeatureRequest is a
 * platform model (not auto-scoped), so studio-side queries are filtered by
 * studioId explicitly; the super-admin side sees them all.
 */
export class FeatureRequestService extends Connection {
  private requireStudioId(studioId: string | null | undefined): string {
    if (!studioId) {
      throw new ApiError("Studio context missing", HttpCode.NOT_FOUND);
    }
    return studioId;
  }

  // ---- Studio side ------------------------------------------------------

  public async create(
    studioId: string | null | undefined,
    userId: string | undefined,
    input: { title?: unknown; description?: unknown },
  ) {
    const id = this.requireStudioId(studioId);
    const title = String(input.title ?? "").trim();
    const description = String(input.description ?? "").trim();

    if (title.length < 3 || title.length > 80) {
      throw new ApiError("Title must be 3-80 characters", HttpCode.BAD_REQUEST);
    }
    if (description.length < 5 || description.length > 500) {
      throw new ApiError(
        "Description must be 5-500 characters",
        HttpCode.BAD_REQUEST,
      );
    }

    const created = await this.featureRequest.create({
      data: {
        studioId: id,
        ...(userId ? { createdByUserId: userId } : {}),
        title,
        description,
      },
    });
    return { message: "Feature request submitted", data: created };
  }

  public async listForStudio(studioId: string | null | undefined) {
    const id = this.requireStudioId(studioId);
    const requests = await this.featureRequest.findMany({
      where: { studioId: id },
      orderBy: { createdAt: "desc" },
    });
    return { message: "Feature requests", data: requests };
  }

  // ---- Platform (super-admin) side --------------------------------------

  public async listAll(status?: string) {
    const where =
      status && FEATURE_REQUEST_STATUSES.includes(status as FeatureRequestStatus)
        ? { status: status as FeatureRequestStatus }
        : {};
    const requests = await this.featureRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { studio: { select: { id: true, name: true, slug: true } } },
    });
    return { message: "Feature requests", data: requests };
  }

  public async updateStatus(id: string, status: string) {
    if (!FEATURE_REQUEST_STATUSES.includes(status as FeatureRequestStatus)) {
      throw new ApiError("Invalid status", HttpCode.BAD_REQUEST);
    }
    const existing = await this.featureRequest.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError("Feature request not found", HttpCode.NOT_FOUND);
    }
    const updated = await this.featureRequest.update({
      where: { id },
      data: { status: status as FeatureRequestStatus },
      include: { studio: { select: { id: true, name: true, slug: true } } },
    });
    return { message: "Feature request updated", data: updated };
  }
}
