import { Login, Signup } from "../models/user";
import { UserRepository } from "./userRepository";
import {
  verifyPassword,
  getPasswordHash,
  generateReferralCode,
} from "../utils/helper";
import { ApiError } from "../middleware/apiError";
import { randomBytes, createHash } from "crypto";
import { NotificationService } from "../notifications/notificationService";
import { NotificationTemplate } from "../notifications/registry";
import {
  passwordResetRequested,
  passwordChanged,
  accountLocked,
  customerWelcome,
  loginAlert,
} from "../notifications/templates/auth";
import { brandFromStudio, platformBrand } from "../notifications/brand";
import { createLoginSession, revokeLoginSessions } from "./sessionService";
import { LoginDeviceMetadata } from "./loginDevice";
import { assertSignInCode } from "./twoFactor";
import { confirmEmailCode, sendEmailCode } from "./emailCode";
import {
  assertNotLocked,
  clearLoginFailures,
  lockoutKey,
  recordLoginFailure,
  unknownUserHash,
} from "./loginLockout";
import { getTenantContext } from "../tenant/context";
import { HttpCode } from "../models/status_codes";
import { isStrongPassword, PASSWORD_RULE_MESSAGE } from "./passwordPolicy";

const notifications = new NotificationService();

export class AuthService extends UserRepository {
  public async signup(data: Signup, device?: LoginDeviceMetadata) {
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
      studioId: newUser.studioId,
    };
    const { token } = await createLoginSession(payload, device);

    // Best-effort welcome email — never blocks account creation if it fails.
    try {
      const studio = await this.currentStudioBranding();
      const brand = brandFromStudio(studio, platformBrand);
      const { subject, html } = customerWelcome(brand, {
        firstName: data.fullName?.split(" ")[0] || "there",
        ...(studio?.name ? { studioName: studio.name } : {}),
        ...(studio?.websiteUrl ? { studioUrl: studio.websiteUrl } : {}),
      });
      await notifications.send({
        template: NotificationTemplate.CUSTOMER_WELCOME,
        to: newUser.email,
        subject,
        html,
        studioId: newUser.studioId ?? null,
        entityType: "User",
        entityId: newUser.id,
      });
    } catch (error) {
      console.error("Failed to send welcome email:", error);
    }

    return {
      message: "User created successfully",
      data: {
        user: {
          id: newUser.id,
          email: newUser.email,
          role: newUser.role,
          studioId: newUser.studioId,
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

  private async sendLockedEmail(
    user: { id: string; email: string; studioId: string | null },
    minutes: number,
  ) {
    try {
      const brand = await this.studioEmailBrand(null, platformBrand);
      const { subject, html } = accountLocked(brand, {
        lockedFor:
          minutes >= 60 ? `${minutes / 60} hours` : `${minutes} minutes`,
        recoveryUrl: await this.linkToStudio("/forgot-password", user.studioId),
      });
      await notifications.send({
        template: NotificationTemplate.AUTH_ACCOUNT_LOCKED,
        to: user.email,
        subject,
        html,
        studioId: user.studioId ?? null,
        entityType: "User",
        // Each lock is its own event; the log would otherwise send just one.
        entityId: `${user.id}:${Date.now()}`,
      });
    } catch (error) {
      console.error("Failed to send account-locked email:", error);
    }
  }

  // Optional for customers: offered in their account, never required.
  public async emailVerificationStatus(userId: string) {
    const user = await this.user.findUnique({
      where: { id: userId },
      select: { emailVerifiedAt: true },
    });
    return {
      message: "Status retrieved",
      data: { verified: Boolean(user?.emailVerifiedAt) },
    };
  }

  public async sendVerificationCode(user: {
    id: string;
    email: string;
    studioId?: string | null;
  }) {
    await sendEmailCode({
      key: `user:${user.id}`,
      to: user.email,
      brand: await this.studioEmailBrand(null, platformBrand),
      studioId: user.studioId ?? null,
    });
    return { message: "Code sent" };
  }

  public async confirmVerificationCode(userId: string, code: unknown) {
    await confirmEmailCode(`user:${userId}`, code);
    await this.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date() },
    });
    return { message: "Email confirmed", data: { verified: true } };
  }

  public async login(data: Login, device?: LoginDeviceMetadata) {
    const lockKey = lockoutKey(getTenantContext()?.studioId, data.email);
    await assertNotLocked(lockKey);

    const user = await this.getByEmail(data.email);
    const isPasswordValid = await verifyPassword(
      data.password,
      user?.password ?? (await unknownUserHash()),
    );
    if (!user || !isPasswordValid) {
      const lock = await recordLoginFailure(lockKey);
      if (lock) {
        if (user && lock.first) {
          // Not awaited, so a real account takes no longer than an unknown one.
          void this.sendLockedEmail(user, lock.minutes);
        }
        throw lock.error;
      }
      throw new ApiError("Invalid email or password", 400);
    }
    await this.assertStaffMayEnter(user);
    await assertSignInCode(user, data.totp, lockKey);
    await clearLoginFailures(lockKey);

    const payload = {
      id: user.id,
      email: user.email,
      role: user.role,
      studioId: user.studioId,
    };
    const { token, isNewDevice, deviceKey } = await createLoginSession(
      payload,
      device,
    );

    if (isNewDevice) {
      try {
        const brand = await this.studioEmailBrand(null, platformBrand);
        const { subject, html } = loginAlert(brand, {
          device: device?.userAgent || "Unknown browser or device",
          ipAddress: device?.ipAddress || "Unavailable",
          signedInAt: new Date().toISOString(),
          recoveryUrl: await this.linkToStudio(
            "/forgot-password",
            user.studioId,
          ),
        });
        await notifications.send({
          template: NotificationTemplate.AUTH_LOGIN_ALERT,
          to: user.email,
          subject,
          html,
          studioId: user.studioId ?? null,
          entityType: "AuthDevice",
          entityId: deviceKey,
        });
      } catch (error) {
        console.error("Failed to send new-device login alert:", error);
      }
    }

    return {
      message: "Login successful",
      data: {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          studioId: user.studioId,
        },
        token,
      },
    };
  }

  /** A staff account the owner has turned off can't sign in. */
  private async assertStaffMayEnter(user: { id: string; role: string }) {
    if (user.role !== "STAFF") return;
    const staff = await this.staff.findFirst({
      where: { userId: user.id },
      select: { active: true },
    });
    if (!staff?.active)
      throw new ApiError(
        "Your access has been turned off. Please ask your studio.",
        HttpCode.FORBIDDEN,
      );
  }

  /**
   * First visit of a staff member whose account the owner created: email a
   * 6-digit code to their address. Always answers the same, so it never says
   * which emails are accounts.
   */
  public async firstVisitCode(email: string) {
    const generic = {
      message:
        "If that email is a new team account, we've sent a code to it. It can take a minute.",
    };
    const user = await this.getByEmail(email);
    if (!user || user.role !== "STAFF" || user.passwordSet) return generic;
    try {
      await sendEmailCode({
        key: `first:${user.id}`,
        to: user.email,
        brand: await this.studioEmailBrand(null, platformBrand),
        studioId: user.studioId ?? null,
      });
    } catch (error) {
      // "Wait a minute" would reveal the account, so it looks the same.
      if (!(error instanceof ApiError && error.statusCode === 429)) throw error;
    }
    return generic;
  }

  /** The code proves the mailbox is theirs; they choose their own password and are signed in. */
  public async firstVisitSetPassword(
    data: { email: string; code: unknown; password: string },
    device?: LoginDeviceMetadata,
  ) {
    if (!isStrongPassword(data.password))
      throw new ApiError(PASSWORD_RULE_MESSAGE, 400);
    const user = await this.getByEmail(data.email);
    const wrong = new ApiError(
      "That code isn't right or has expired. Check it, or ask for a new one.",
      400,
    );
    if (!user || user.role !== "STAFF" || user.passwordSet) throw wrong;
    await this.assertStaffMayEnter(user);
    await confirmEmailCode(`first:${user.id}`, data.code);
    await this.user.update({
      where: { id: user.id },
      data: {
        password: await getPasswordHash(data.password),
        passwordSet: true,
        emailVerifiedAt: new Date(),
      },
    });
    const { token } = await createLoginSession(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        studioId: user.studioId,
      },
      device,
    );
    return {
      message: "Password set. You're signed in.",
      data: {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          studioId: user.studioId,
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
    // The account belongs to this studio, so the reset happens on its site.
    const resetUrl = await this.linkToStudio(
      `/reset-password/${resetToken}`,
      user.studioId,
    );

    try {
      const brand = await this.studioEmailBrand(null, platformBrand);
      const { subject, html } = passwordResetRequested(brand, {
        resetUrl,
        expiresInMinutes: 60,
      });
      await notifications.send({
        template: NotificationTemplate.AUTH_PASSWORD_RESET_REQUESTED,
        to: user.email,
        subject,
        html,
        studioId: getTenantContext()?.studioId ?? null,
        entityType: "User",
        // Keyed by the token hash, not the user id — each request is its own
        // event (a user can legitimately request a reset more than once).
        entityId: hashedToken,
      });
    } catch {
      // Roll back the token if the email couldn't even be queued/sent. Once a
      // queue is configured (REDIS_URL), "sent" here just means "enqueued" —
      // a delivery failure after retries happens later in the worker and can't
      // roll this back; that's the normal tradeoff of background email.
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
    if (
      !user.resetTokenExpiry ||
      new Date(user.resetTokenExpiry) < new Date()
    ) {
      throw new ApiError("Invalid or expired token", 400);
    }

    // hash new password and update user; clear reset token fields
    // A reset proves ownership, so it reopens sign-in straight away.
    await clearLoginFailures(lockoutKey(user.studioId, user.email));
    const newHashedPassword = await getPasswordHash(newPassword);
    await this.resetPasswordByUserId(user.id, newHashedPassword);
    await revokeLoginSessions(user.id);

    // Best-effort security notification — never blocks the (already
    // successful) password reset if it fails.
    try {
      const brand = await this.studioEmailBrand(null, platformBrand);
      const { subject, html } = passwordChanged(brand, {
        email: user.email,
        changedAt: new Date().toLocaleString("en-GB", {
          dateStyle: "medium",
          timeStyle: "short",
        }),
      });
      await notifications.send({
        template: NotificationTemplate.AUTH_PASSWORD_CHANGED,
        to: user.email,
        subject,
        html,
        studioId: getTenantContext()?.studioId ?? null,
        entityType: "User",
        entityId: `${user.id}:${hashedToken}`,
      });
    } catch (error) {
      console.error("Failed to send password-changed notification:", error);
    }

    return { message: "Password has been reset successfully" };
  }
}
