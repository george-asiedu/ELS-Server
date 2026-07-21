import { UserRepository } from "../auth/userRepository";
import { ApiError } from "../middleware/apiError";

// 100 points = GHS 1  (so 1000 pts = GHS 10). Redeem in whole GHS increments.
const POINTS_PER_GHS = 100;
const MIN_REDEEM_POINTS = 1000;

export class AccountService extends UserRepository {
  public async getLoyalty(userId: string) {
    let points = await this.getLoyaltyPoints(userId);
    if (!points) {
      // Backfill for accounts created before loyalty bootstrap existed.
      points = await this.createLoyaltyPoints(userId);
    }
    return { message: "Loyalty points retrieved successfully", data: points };
  }

  public async getTransactions(userId: string) {
    const transactions = await this.getLoyaltyTransactions(userId);
    return {
      message: "Loyalty transactions retrieved successfully",
      data: transactions,
    };
  }

  public async redeem(userId: string, points: number) {
    if (!Number.isInteger(points) || points <= 0) {
      throw new ApiError("Points to redeem must be a positive whole number", 400);
    }
    if (points < MIN_REDEEM_POINTS) {
      throw new ApiError(
        `You must redeem at least ${MIN_REDEEM_POINTS} points`,
        400,
      );
    }
    if (points % POINTS_PER_GHS !== 0) {
      throw new ApiError(
        `Points must be redeemed in multiples of ${POINTS_PER_GHS}`,
        400,
      );
    }

    const balance = await this.getLoyaltyPoints(userId);
    if (!balance || balance.points < points) {
      throw new ApiError("You don't have enough points to redeem", 400);
    }

    const ghsValue = points / POINTS_PER_GHS;

    const updated = await this.loyaltyPoints.update({
      where: { userId },
      data: { points: { decrement: points } },
    });

    await this.loyaltyTransaction.create({
      data: {
        userId,
        points: -points,
        type: "REDEEMED",
        description: `Redeemed ${points} points for GHS ${ghsValue} off`,
      },
    });

    return {
      message: `Redeemed ${points} points for GHS ${ghsValue} off`,
      data: { points: updated.points, redeemed: points, ghsValue },
    };
  }

  public async getReferral(userId: string) {
    let code = await this.getReferralCodeByUserId(userId);
    if (!code) {
      const generated = `ELS${userId.slice(-6).toUpperCase()}`;
      code = await this.createReferralCode(userId, generated);
    }
    return { message: "Referral code retrieved successfully", data: code };
  }
}
