import { Request, Response, NextFunction } from "express";
import { env } from "../config/env.config";
import { ApiError } from "./apiError";
import { HttpCode } from "../models/status_codes";
import { runWithTenant } from "../tenant/context";
import { resolveStudioBySlug } from "../tenant/studioResolver";

// Derive a studio slug from the request: explicit header wins (the SPA sends it
// based on the subdomain it's served from), then the real subdomain when a root
// domain is configured. Null when the request names no studio. There is no
// default studio: accounts belong to one studio (the same email can exist in
// two), so guessing would sign people in to, or show them, the wrong studio.
const studioSlugFromRequest = (req: Request): string | null => {
  const header = req.headers["x-studio-slug"];
  if (typeof header === "string" && header.trim()) {
    return header.trim().toLowerCase();
  }

  if (env.rootDomain && req.hostname.endsWith(`.${env.rootDomain}`)) {
    const sub = req.hostname.slice(0, -(env.rootDomain.length + 1));
    if (sub && sub !== "www") return sub.toLowerCase();
  }

  return null;
};

// Requests that operate outside any single studio (super-admin surface) or that
// must resolve their studio internally (the Paystack webhook, which finds the
// studio via the globally-unique payment reference; the custom-domain lookup,
// which is how a studio's own domain finds out which studio it is).
const isPlatformPath = (path: string) =>
  path.startsWith("/platform") ||
  path.startsWith("/onboarding") ||
  path === "/studio/resolve-domain";
const isWebhookPath = (path: string) => path.endsWith("/webhook");

/**
 * Establishes the tenant context for the whole request. Mounted on /api so
 * everything downstream (services querying scoped models) runs inside it.
 */
export const resolveTenant = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    if (isPlatformPath(req.path) || isWebhookPath(req.path)) {
      // Super-admin / webhook context: scoping is bypassed. Route-level guards
      // (requireSuperAdmin) still protect platform endpoints, and the webhook
      // resolves its studio from the payment reference.
      const ctx = { studioId: null, superAdmin: true };
      req.tenantContext = ctx;
      return runWithTenant(ctx, () => next());
    }

    const slug = studioSlugFromRequest(req);
    if (!slug) {
      throw new ApiError(
        "Choose a studio first: open the studio's own web address",
        HttpCode.BAD_REQUEST,
      );
    }
    const studio = await resolveStudioBySlug(slug);

    if (!studio) {
      throw new ApiError("Studio not found", HttpCode.NOT_FOUND);
    }
    if (studio.status === "SUSPENDED") {
      throw new ApiError(
        "This studio is currently unavailable",
        HttpCode.FORBIDDEN,
      );
    }

    // Expose for downstream handlers that want the id without reading ALS.
    req.studioId = studio.id;

    const ctx = { studioId: studio.id, superAdmin: false };
    req.tenantContext = ctx;
    return runWithTenant(ctx, () => next());
  } catch (error) {
    return next(error);
  }
};

/**
 * Re-establish the tenant ALS context for handlers that would otherwise run
 * outside it. Middleware that awaits on I/O predating resolveTenant's
 * `runWithTenant` — reading the request stream, or an async auth lookup — can
 * resume on a callback whose async context is not the tenant store, so the
 * controller it invokes runs OUTSIDE that store and the scoping extension
 * fails closed. `req.tenantContext` is a plain property that survives any such
 * hop, so we re-enter the store from it here. `authenticate` and
 * `optionalAuth` finish by calling this, so authenticated routes are covered;
 * mount it explicitly only after other middleware that awaits I/O (e.g. a
 * body parser that consumes the stream) on a route that reads or writes
 * tenant-scoped data.
 */
export const reenterTenant = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  const ctx = req.tenantContext ?? {
    studioId: req.studioId ?? null,
    superAdmin: false,
  };
  return runWithTenant(ctx, () => next());
};
