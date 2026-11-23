import { readSessionCookie, setSessionCookie } from "../auth/sessionCookie";
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.config";
import { ApiError } from "./apiError";
import { HttpCode } from "../models/status_codes";
import { AuthToken } from "../models/user";
import {
  isActiveLoginSession,
  renewLoginSession,
} from "../auth/sessionService";
import { reenterTenant } from "./tenant";
import { createTenantClient } from "../tenant/tenantClient";

interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string;
  studioId?: string | null;
  token: string;
  jti?: string;
}

const extractToken = readSessionCookie;

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const token = extractToken(req);
    if (!token) {
      throw new ApiError(
        "Authentication required",
        HttpCode.UNAUTHORIZED_ACCESS,
      );
    }

    const decoded = jwt.verify(token, env.JWT_SECRET) as AccessTokenPayload;

    if (decoded.token !== AuthToken.ACCESS_TOKEN) {
      throw new ApiError("Invalid token type", HttpCode.UNAUTHORIZED_ACCESS);
    }
    if (
      !decoded.jti ||
      !(await isActiveLoginSession(decoded.jti, decoded.sub))
    ) {
      throw new ApiError(
        "Session expired or revoked. Please sign in again.",
        HttpCode.UNAUTHORIZED_ACCESS,
      );
    }

    // Reject a token minted for one studio being used against another.
    if (
      decoded.role !== "SUPER_ADMIN" &&
      decoded.studioId &&
      req.studioId &&
      decoded.studioId !== req.studioId
    ) {
      throw new ApiError(
        "Token does not belong to this studio",
        HttpCode.UNAUTHORIZED_ACCESS,
      );
    }

    req.user = {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role,
      studioId: decoded.studioId ?? null,
    };
    req.authSessionId = decoded.jti;
    const renewed = await renewLoginSession(
      decoded as unknown as Parameters<typeof renewLoginSession>[0],
    );
    if (renewed) setSessionCookie(req, res, renewed);

    // The session lookup above awaited I/O, so continue in the request's
    // tenant context explicitly (see reenterTenant) — every authenticated
    // route gets this, rather than each route having to remember it.
    return reenterTenant(req, res, next);
  } catch (error) {
    return next(error);
  }
};

const { raw: rawDb } = createTenantClient();

// What an admin without two-step sign-in can still reach: setting it up,
// signing out, their own details, and their notification devices.
const TWO_FACTOR_EXEMPT = /^\/(auth\/(2fa|logout)|me$|push|inbox)/;

/**
 * Admins and the super admin must have two-step sign-in on before they can
 * use their dashboard (REQUIRE_2FA_FOR_ADMINS, on by default). The client
 * shows the setup screen when it gets TWO_FACTOR_SETUP_REQUIRED.
 */
const requireTwoFactor = (req: Request, res: Response, next: NextFunction) => {
  if (!env.require2faForAdmins || TWO_FACTOR_EXEMPT.test(req.path))
    return next();
  rawDb.user
    .findUnique({ where: { id: req.user!.id }, select: { totpEnabled: true } })
    .then((u) =>
      u?.totpEnabled
        ? reenterTenant(req, res, next)
        : next(
            new ApiError(
              "Turn on two-step sign-in to use the dashboard",
              HttpCode.FORBIDDEN,
              [{ code: "TWO_FACTOR_SETUP_REQUIRED" }],
            ),
          ),
    )
    .catch(next);
};

export const requireAdmin = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  if (!req.user) {
    return next(
      new ApiError("Authentication required", HttpCode.UNAUTHORIZED_ACCESS),
    );
  }
  if (req.user.role !== "ADMIN") {
    return next(new ApiError("Admin access required", HttpCode.FORBIDDEN));
  }
  return requireTwoFactor(req, _res, next);
};

// Platform operator only — the super-admin dashboard.
export const requireSuperAdmin = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  if (!req.user) {
    return next(
      new ApiError("Authentication required", HttpCode.UNAUTHORIZED_ACCESS),
    );
  }
  if (req.user.role !== "SUPER_ADMIN") {
    return next(
      new ApiError("Super admin access required", HttpCode.FORBIDDEN),
    );
  }
  return requireTwoFactor(req, _res, next);
};

// Booking is customer-only — admins and guests are rejected.
export const requireCustomer = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  if (!req.user) {
    return next(
      new ApiError(
        "Please log in to book an appointment",
        HttpCode.UNAUTHORIZED_ACCESS,
      ),
    );
  }
  if (req.user.role !== "CUSTOMER") {
    return next(
      new ApiError(
        "Only customer accounts can book appointments",
        HttpCode.FORBIDDEN,
      ),
    );
  }
  return next();
};

// Attaches req.user when a valid token is present, but does not require it.
// Used for endpoints that behave differently for guests vs logged-in users.
export const optionalAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    const token = extractToken(req);
    if (!token) {
      return next();
    }
    const decoded = jwt.verify(token, env.JWT_SECRET) as AccessTokenPayload;
    if (decoded.token === AuthToken.ACCESS_TOKEN) {
      if (
        !decoded.jti ||
        !(await isActiveLoginSession(decoded.jti, decoded.sub))
      )
        return next();
      req.user = {
        id: decoded.sub,
        email: decoded.email,
        role: decoded.role,
        studioId: decoded.studioId ?? null,
      };
      req.authSessionId = decoded.jti;
    }
    return reenterTenant(req, _res, next);
  } catch {
    // Ignore invalid tokens for optional auth
    return reenterTenant(req, _res, next);
  }
};
