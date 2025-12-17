import { Login, Signup } from "../models/user";
import { UserRepository } from "./userRepository";
import {
  loginToken,
  verifyPassword,
  getPasswordHash
} from "../utils/helper";
import { ApiError } from "../middleware/apiError";
import { env } from "../config/env.config";
import { randomBytes, createHash } from "crypto";

export class AuthService extends UserRepository {
  public async signup(data: Signup) {
    const existingUser = await this.checkExistingUser(data.email);
    if (existingUser) {
      throw new Error("User with this email already exists");
    }

    await this.createUser(data);

    return { message: "User created successfully" };
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
    if (!user) {
      throw new ApiError("User not found", 404);
    }

    const resetToken = randomBytes(32).toString("hex");
    const hashedToken = createHash("sha256").update(resetToken).digest("hex");
    const expiry = new Date(Date.now() + 60 * 60 * 1000);
    await this.setResetTokenForUser(user.id, hashedToken, expiry);
    const resetUrl = `${env.clientUrl}/reset-password/${resetToken}`;

    return { 
      message: "Password reset link sent",
      data: { resetUrl },
    };
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
