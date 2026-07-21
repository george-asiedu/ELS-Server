import { Connection } from "../db/dbConnection";
import { Profile, Signup } from "../models/user";
import { getPasswordHash } from "../utils/helper";

export class UserRepository extends Connection {
  public async getByEmail(email: string) {
    const user = await this.user.findUnique({
      where: { email },
    });
    return user;
  }

  public async getByID(id: string) {
    const user = await this.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        profile: true,
      },
    });
    return user;
  }

  public async checkExistingUser(email: string) {
    const existingUser = await this.user.findUnique({
      where: { email },
      select: { email: true },
    });

    return !!existingUser;
  }

  public async createUser(data: Signup) {
    const hashedPassword = await getPasswordHash(data.password);
    const newUser = await this.user.create({
      data: {
        email: data.email,
        password: hashedPassword,
      },
    });

    return newUser;
  }
  
  public async updateEmail(id: string, email: string) {
    const updatedUser = await this.user.update({
      where: { id },
      data: { email },
    });

    return updatedUser;
  }
  
  public async updatePassword(id: string, password: string) {
    const hashedPassword = await getPasswordHash(password);
    const updatedUser = await this.user.update({
      where: { id },
      data: { password: hashedPassword },
    });

    return updatedUser;
  }

  public async createProfile(userId: string, data: Profile) {
    const cleanData = Object.fromEntries(
      Object.entries(data).filter(([_, value]) => value !== undefined)
    );;
    
    return await this.profile.upsert({
      where: { userId },
      update: cleanData,
      create: {
        ...cleanData,
        user: { connect: { id: userId } }
      },
      include: {
        user: { select: { id: true, email: true, role: true } }
      }
    });
  }

  public async getProfile(id: string) {
    const profile = await this.profile.findUnique({
      where: { userId: id },
      include: {
        user: {
          select: { id: true, email: true, role: true },
        },
      },
    });
    return profile;
  }

  public async deleteUser(id: string) {
    return await this.user.delete({
      where: { id },
    });
  }

  public async deleteProfile(id: string) {
    return await this.profile.delete({
      where: { id },
    });
  }
  
  public async setResetTokenForUser(userId: string, hashedToken: string, expiry: Date) {
    return await this.user.update({
      where: { id: userId },
      data: {
        resetToken: hashedToken,
        resetTokenExpiry: expiry,
      },
    });
  }
  
  public async findUserByResetToken(hashedToken: string) {
    const user = await this.user.findFirst({
      where: {
        resetToken: hashedToken,
      },
    });
    return user;
  }
  
  public async resetPasswordByUserId(userId: string, newHashedPassword: string) {
    return await this.user.update({
      where: { id: userId },
      data: {
        password: newHashedPassword,
        resetToken: null,
        resetTokenExpiry: null,
      },
    });
  }

  // ---------- Loyalty ----------
  public async createLoyaltyPoints(userId: string) {
    return await this.loyaltyPoints.upsert({
      where: { userId },
      update: {},
      create: { userId, points: 0, lifetimePoints: 0 },
    });
  }

  public async getLoyaltyPoints(userId: string) {
    return await this.loyaltyPoints.findUnique({ where: { userId } });
  }

  public async getLoyaltyTransactions(userId: string, limit = 10) {
    return await this.loyaltyTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  // ---------- Referral ----------
  public async createReferralCode(userId: string, code: string) {
    return await this.referralCode.upsert({
      where: { userId },
      update: {},
      create: { userId, code },
    });
  }

  public async getReferralCodeByUserId(userId: string) {
    return await this.referralCode.findUnique({ where: { userId } });
  }

  public async getReferralCodeByCode(code: string) {
    return await this.referralCode.findUnique({ where: { code } });
  }

  public async createReferral(
    referrerId: string,
    referredId: string,
    referralCodeId: string,
  ) {
    return await this.referral.create({
      data: { referrerId, referredId, referralCodeId },
    });
  }

  public async incrementReferralCodeUses(id: string) {
    return await this.referralCode.update({
      where: { id },
      data: { uses: { increment: 1 } },
    });
  }
}
