import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.config";
import { ApiError } from "./apiError";
import { HttpCode } from "../models/status_codes";
import { AuthToken } from "../models/user";

interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string;
  studioId?: string | null;
  token: string;
}

const extractToken = (req: Request): string | null => {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    return header.slice(7).trim();
  }
  return null;
};

export const authenticate = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    const token = extractToken(req);
    if (!token) {
      throw new ApiError("Authentication required", HttpCode.UNAUTHORIZED_ACCESS);
    }

    const decoded = jwt.verify(token, env.JWT_SECRET) as AccessTokenPayload;

    if (decoded.token !== AuthToken.ACCESS_TOKEN) {
      throw new ApiError("Invalid token type", HttpCode.UNAUTHORIZED_ACCESS);
    }

    // Reject a token minted for one studio being used against another.
    if (
      decoded.role !== "SUPER_ADMIN" &&
      decoded.studioId &&
      req.studioId &&
      decoded.studioId !== req.studioId
    ) {
      throw new ApiError("Token does not belong to this studio", HttpCode.UNAUTHORIZED_ACCESS);
    }

    req.user = {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role,
      studioId: decoded.studioId ?? null,
    };

    return next();
  } catch (error) {
    return next(error);
  }
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
    return next(
      new ApiError("Admin access required", HttpCode.FORBIDDEN),
    );
  }
  return next();
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
    return next(new ApiError("Super admin access required", HttpCode.FORBIDDEN));
  }
  return next();
};

// Booking is customer-only — admins and guests are rejected.
export const requireCustomer = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  if (!req.user) {
    return next(
      new ApiError("Please log in to book an appointment", HttpCode.UNAUTHORIZED_ACCESS),
    );
  }
  if (req.user.role !== "CUSTOMER") {
    return next(
      new ApiError("Only customer accounts can book appointments", HttpCode.FORBIDDEN),
    );
  }
  return next();
};

// Attaches req.user when a valid token is present, but does not require it.
// Used for endpoints that behave differently for guests vs logged-in users.
export const optionalAuth = (
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
      req.user = {
        id: decoded.sub,
        email: decoded.email,
        role: decoded.role,
        studioId: decoded.studioId ?? null,
      };
    }
    return next();
  } catch {
    // Ignore invalid tokens for optional auth
    return next();
  }
};
