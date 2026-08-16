import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import { HttpCode } from "../models/status_codes";
import { loginToken, verifyPassword } from "../utils/helper";

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
}
