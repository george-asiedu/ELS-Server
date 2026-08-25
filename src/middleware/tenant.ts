import { Request, Response, NextFunction } from "express";
import { env } from "../config/env.config";
import { ApiError } from "./apiError";
import { HttpCode } from "../models/status_codes";
import { runWithTenant } from "../tenant/context";
import { resolveStudioBySlug } from "../tenant/studioResolver";

// Derive a studio slug from the request: explicit header wins (the SPA sends it
// based on the subdomain it's served from), then the real subdomain when a root
// domain is configured, then the configured default (bridges the existing
// single-tenant frontend during rollout).
const studioSlugFromRequest = (req: Request): string => {
  const header = req.headers["x-studio-slug"];
  if (typeof header === "string" && header.trim()) {
    return header.trim().toLowerCase();
  }

  if (env.rootDomain && req.hostname.endsWith(`.${env.rootDomain}`)) {
    const sub = req.hostname.slice(0, -(env.rootDomain.length + 1));
    if (sub && sub !== "www") return sub.toLowerCase();
  }

  return env.defaultStudioSlug;
};

// Requests that operate outside any single studio (super-admin surface) or that
// must resolve their studio internally (the Paystack webhook, which finds the
// studio via the globally-unique payment reference).
const isPlatformPath = (path: string) => path.startsWith("/platform");
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
    const studio = await resolveStudioBySlug(slug);

    if (!studio) {
      throw new ApiError("Studio not found", HttpCode.NOT_FOUND);
    }
    if (studio.status === "SUSPENDED") {
      throw new ApiError("This studio is currently unavailable", HttpCode.FORBIDDEN);
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
 * Re-establish the tenant ALS context after a body parser that breaks async
 * context propagation. multer (multipart/form-data) parses the request stream —
 * whose underlying socket predates resolveTenant's `runWithTenant` — so its
 * completion callback, and the controller it invokes, run OUTSIDE the tenant
 * store and the scoping extension would fail closed. `req.tenantContext` is a
 * plain property that survives, so we re-enter the store here. Mount this
 * immediately AFTER the multer middleware on every multipart route.
 */
export const reenterTenant = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  const ctx =
    req.tenantContext ?? { studioId: req.studioId ?? null, superAdmin: false };
  return runWithTenant(ctx, () => next());
};
