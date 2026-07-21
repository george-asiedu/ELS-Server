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

    req.user = {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role,
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
      };
    }
    return next();
  } catch {
    // Ignore invalid tokens for optional auth
    return next();
  }
};
