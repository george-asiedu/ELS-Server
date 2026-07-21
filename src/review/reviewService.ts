import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import { CreateReviewInput } from "./reviewModels";

const reviewInclude = {
  user: {
    select: {
      email: true,
      profile: { select: { fullName: true } },
    },
  },
  service: { select: { name: true } },
} as const;

export class ReviewService extends Connection {
  public async create(userId: string, data: CreateReviewInput) {
    const review = await this.review.create({
      data: {
        rating: data.rating,
        content: data.content,
        userId,
        ...(data.serviceId ? { serviceId: data.serviceId } : {}),
      },
      include: reviewInclude,
    });
    return { message: "Review submitted successfully", data: review };
  }

  public async listApproved(limit = 6) {
    const reviews = await this.review.findMany({
      where: { approved: true },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: reviewInclude,
    });
    return { message: "Reviews retrieved successfully", data: reviews };
  }

  public async listAll() {
    const reviews = await this.review.findMany({
      orderBy: { createdAt: "desc" },
      include: reviewInclude,
    });
    return { message: "Reviews retrieved successfully", data: reviews };
  }

  public async setApproved(id: string, approved: boolean) {
    const existing = await this.review.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError("Review not found", 404);
    }
    const review = await this.review.update({
      where: { id },
      data: { approved },
      include: reviewInclude,
    });
    return { message: "Review updated", data: review };
  }

  public async remove(id: string) {
    const existing = await this.review.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError("Review not found", 404);
    }
    await this.review.delete({ where: { id } });
    return { message: "Review deleted successfully" };
  }
}
