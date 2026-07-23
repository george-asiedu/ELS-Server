import { Login, Signup } from "../models/user";
import { UserRepository } from "./userRepository";
import {
  loginToken,
  verifyPassword,
  getPasswordHash,
  generateReferralCode
} from "../utils/helper";
import { ApiError } from "../middleware/apiError";
import { env } from "../config/env.config";
import { randomBytes, createHash } from "crypto";
import { EmailService } from "../email/emailService";

const emailService = new EmailService();

export class AuthService extends UserRepository {
  public async signup(data: Signup) {
    const existingUser = await this.checkExistingUser(data.email);
    if (existingUser) {
      throw new ApiError("User with this email already exists", 409);
    }

    const newUser = await this.createUser(data);

    // Bootstrap the customer account: profile, loyalty points, referral code.
    if (data.fullName || data.phone) {
      await this.createProfile(newUser.id, {
        ...(data.fullName ? { fullName: data.fullName } : {}),
        ...(data.phone ? { phone: data.phone } : {}),
        email: data.email,
      });
    }

    await this.createLoyaltyPoints(newUser.id);

    const referralCode = await this.generateUniqueReferralCode();
    await this.createReferralCode(newUser.id, referralCode);

    // Handle inbound referral, if a code was supplied.
    if (data.referralCode) {
      const referrer = await this.getReferralCodeByCode(
        data.referralCode.toUpperCase(),
      );
      if (referrer) {
        await this.createReferral(referrer.userId, newUser.id, referrer.id);
        await this.incrementReferralCodeUses(referrer.id);
      }
    }

    const payload = {
      id: newUser.id,
      email: newUser.email,
      role: newUser.role,
    };
    const token = loginToken(payload);

    return {
      message: "User created successfully",
      data: {
        user: {
          id: newUser.id,
          email: newUser.email,
          role: newUser.role,
        },
        token,
      },
    };
  }

  // Generate a short referral code, retrying on the rare chance of a collision.
  private async generateUniqueReferralCode(): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const code = generateReferralCode();
      const existing = await this.getReferralCodeByCode(code);
      if (!existing) return code;
    }
    return generateReferralCode(8);
  }

  public async login(data: Login) {
    const user = await this.getByEmail(data.email);
    if (!user) {
      throw new ApiError("Invalid email or password", 400);
    }

    const isPasswordValid = await verifyPassword(data.password, user.password);
    if (!isPasswordValid) {
      throw new ApiError("Invalid email or password", 400);
    }

    const payload = {
      id: user.id,
      email: user.email,
      role: user.role,
    };
    const token = loginToken(payload);

    return {
      message: "Login successful",
      data: {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
        token,
      },
    };
  }
  
  public async forgotPassword(email: string) {
    const user = await this.getByEmail(email);

    // Always respond the same way so we don't reveal which emails are registered.
    const genericResponse = {
      message:
        "If an account exists for that email, a password reset link has been sent.",
    };

    if (!user) {
      return genericResponse;
    }

    const resetToken = randomBytes(32).toString("hex");
    const hashedToken = createHash("sha256").update(resetToken).digest("hex");
    const expiry = new Date(Date.now() + 60 * 60 * 1000);
    await this.setResetTokenForUser(user.id, hashedToken, expiry);
    const resetUrl = `${env.clientUrl}/reset-password/${resetToken}`;

    try {
      await emailService.sendPasswordReset(user.email, resetUrl);
    } catch (error) {
      // Roll back the token if the email couldn't be delivered.
      await this.setResetTokenForUser(user.id, "", new Date(0));
      throw new ApiError("Failed to send password reset email", 500);
    }

    return genericResponse;
  }
  
  public async resetPassword(token: string, newPassword: string) {
      if (!token || !newPassword) {
        throw new ApiError("Token and new password are required", 400);
      }
  
      // hash incoming token to compare with stored hashed value
      const hashedToken = createHash("sha256").update(token).digest("hex");
  
      // find user by hashed token
      const user = await this.findUserByResetToken(hashedToken);
      if (!user) {
        throw new ApiError("Invalid or expired token", 400);
      }
  
      // check expiry
      if (!user.resetTokenExpiry || new Date(user.resetTokenExpiry) < new Date()) {
        throw new ApiError("Invalid or expired token", 400);
      }
  
      // hash new password and update user; clear reset token fields
      const newHashedPassword = await getPasswordHash(newPassword);
      await this.resetPasswordByUserId(user.id, newHashedPassword);
  
      return { message: "Password has been reset successfully" };
    }
}
