import { randomBytes, createHash } from "crypto";
import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import { HttpCode } from "../models/status_codes";
import { loginToken, verifyPassword, getPasswordHash } from "../utils/helper";
import { env } from "../config/env.config";
import { EmailService } from "../email/emailService";

const emailService = new EmailService();

/**
 * Authentication for the platform super admin. Super admins have no studio
 * (studioId is null), so this runs in the platform (superAdmin) context where
 * the tenant extension is bypassed and the user lookup spans all studios.
 */
export class PlatformAuthService extends Connection {
  public async login(email: string, password: string) {
    const normalized = String(email ?? "").trim().toLowerCase();
    // Scope strictly to super admins so a studio user with the same email can
    // never authenticate against the platform surface.
    const user = await this.user.findFirst({
      where: { email: normalized, role: "SUPER_ADMIN" },
    });
    if (!user) {
      throw new ApiError("Invalid email or password", HttpCode.BAD_REQUEST);
    }

    const valid = await verifyPassword(password, user.password);
    if (!valid) {
      throw new ApiError("Invalid email or password", HttpCode.BAD_REQUEST);
    }

    const token = loginToken({
      id: user.id,
      email: user.email,
      role: user.role,
      studioId: null,
    });

    return {
      message: "Login successful",
      data: {
        user: { id: user.id, email: user.email, role: user.role },
        token,
      },
    };
  }

  // Send a reset link to the super admin. Same privacy-preserving response
  // whether or not the email matches an account.
  public async forgotPassword(email: string) {
    const normalized = String(email ?? "").trim().toLowerCase();
    const generic = {
      message:
        "If a super-admin account exists for that email, a reset link has been sent.",
    };
    const user = await this.user.findFirst({
      where: { email: normalized, role: "SUPER_ADMIN" },
    });
    if (!user) return generic;

    const resetToken = randomBytes(32).toString("hex");
    const hashedToken = createHash("sha256").update(resetToken).digest("hex");
    const expiry = new Date(Date.now() + 60 * 60 * 1000);
    await this.user.update({
      where: { id: user.id },
      data: { resetToken: hashedToken, resetTokenExpiry: expiry },
    });

    const resetUrl = `${env.clientUrl}/platform/reset-password/${resetToken}`;
    try {
      await emailService.sendPasswordReset(user.email, resetUrl, "Zuri Studios");
    } catch {
      await this.user.update({
        where: { id: user.id },
        data: { resetToken: null, resetTokenExpiry: null },
      });
      throw new ApiError("Failed to send reset email", HttpCode.INTERNAL_SERVER_ERROR);
    }
    return generic;
  }

  public async resetPassword(token: string, newPassword: string) {
    if (!token || !newPassword) {
      throw new ApiError("Token and new password are required", HttpCode.BAD_REQUEST);
    }
    const hashedToken = createHash("sha256").update(token).digest("hex");
    const user = await this.user.findFirst({
      where: { resetToken: hashedToken, role: "SUPER_ADMIN" },
    });
    if (
      !user ||
      !user.resetTokenExpiry ||
      new Date(user.resetTokenExpiry) < new Date()
    ) {
      throw new ApiError("Invalid or expired token", HttpCode.BAD_REQUEST);
    }
    const password = await getPasswordHash(newPassword);
    await this.user.update({
      where: { id: user.id },
      data: { password, resetToken: null, resetTokenExpiry: null },
    });
    return { message: "Password has been reset successfully" };
  }
}
