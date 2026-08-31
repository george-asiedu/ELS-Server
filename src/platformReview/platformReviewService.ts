import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import { HttpCode } from "../models/status_codes";

/**
 * Testimonials studios write about the platform, shown on the marketing landing
 * page after the super admin approves them. Not tenant-scoped, so studio-side
 * queries filter by studioId explicitly.
 */
export class PlatformReviewService extends Connection {
  // Public: approved testimonials for the landing page.
  public async listApproved() {
    const reviews = await this.platformReview.findMany({
      where: { approved: true },
      orderBy: { createdAt: "desc" },
      take: 24,
      select: { id: true, authorName: true, authorRole: true, content: true, rating: true },
    });
    return { message: "Testimonials", data: reviews };
  }

  // Studio admin submits a testimonial about the platform.
  public async create(
    studioId: string | null | undefined,
    userId: string | undefined,
    input: { authorName?: unknown; authorRole?: unknown; content?: unknown; rating?: unknown },
  ) {
    if (!studioId) throw new ApiError("Studio context missing", HttpCode.NOT_FOUND);
    const authorName = String(input.authorName ?? "").trim();
    const authorRole = String(input.authorRole ?? "").trim();
    const content = String(input.content ?? "").trim();
    const rating = Math.round(Number(input.rating));

    if (authorName.length < 2 || authorName.length > 60) {
      throw new ApiError("Name must be 2-60 characters", HttpCode.BAD_REQUEST);
    }
    if (content.length < 5 || content.length > 400) {
      throw new ApiError("Testimonial must be 5-400 characters", HttpCode.BAD_REQUEST);
    }
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      throw new ApiError("Rating must be 1-5", HttpCode.BAD_REQUEST);
    }

    const created = await this.platformReview.create({
      data: {
        studioId,
        ...(userId ? { createdByUserId: userId } : {}),
        authorName,
        ...(authorRole ? { authorRole } : {}),
        content,
        rating,
        approved: false,
      },
    });
    return {
      message: "Testimonial submitted for review",
      data: created,
    };
  }

  public async listForStudio(studioId: string | null | undefined) {
    if (!studioId) throw new ApiError("Studio context missing", HttpCode.NOT_FOUND);
    const reviews = await this.platformReview.findMany({
      where: { studioId },
      orderBy: { createdAt: "desc" },
    });
    return { message: "Your testimonials", data: reviews };
  }

  // ---- Super admin ----
  public async listAll() {
    const reviews = await this.platformReview.findMany({
      orderBy: { createdAt: "desc" },
    });
    const studioIds = [
      ...new Set(reviews.map((r) => r.studioId).filter((x): x is string => Boolean(x))),
    ];
    const studios = studioIds.length
      ? await this.studio.findMany({
          where: { id: { in: studioIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(studios.map((s) => [s.id, s.name]));
    return {
      message: "Testimonials",
      data: reviews.map((r) => ({
        ...r,
        studioName: r.studioId ? nameById.get(r.studioId) ?? null : null,
      })),
    };
  }

  public async setApproved(id: string, approved: boolean) {
    const existing = await this.platformReview.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Testimonial not found", HttpCode.NOT_FOUND);
    const updated = await this.platformReview.update({
      where: { id },
      data: { approved },
    });
    return { message: "Testimonial updated", data: updated };
  }

  public async remove(id: string) {
    const existing = await this.platformReview.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Testimonial not found", HttpCode.NOT_FOUND);
    await this.platformReview.delete({ where: { id } });
    return { message: "Testimonial deleted" };
  }
}
