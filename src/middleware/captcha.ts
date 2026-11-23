import { NextFunction, Request, Response } from "express";
import { env } from "../config/env.config";
import { ApiError } from "./apiError";

// The security check on guest actions (booking, buying, paying a bill without
// an account), using Cloudflare Turnstile. The browser sends the token it got
// as X-Captcha-Token; it is checked with Cloudflare here, and each works once.
//
// With no TURNSTILE_SECRET_KEY it is open outside production (with a one-time
// warning) and closed in production, so a missing setting can't silently leave
// guest actions unprotected.

let warned = false;

export const requireCaptcha = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  try {
    const secret = env.turnstileSecret;
    if (!secret) {
      if (env.nodeEnv === "production")
        throw new ApiError(
          "Guest actions aren't set up on this server yet",
          503,
        );
      if (!warned) {
        warned = true;
        console.warn(
          "TURNSTILE_SECRET_KEY isn't set: the security check is skipped for guest actions. Set it before going live.",
        );
      }
      return next();
    }
    const token = String(req.header("x-captcha-token") ?? "");
    if (!token)
      throw new ApiError(
        "Please complete the security check and try again",
        400,
      );
    const body = new URLSearchParams({ secret, response: token });
    if (req.ip) body.set("remoteip", req.ip);
    let ok = false;
    // One retry: a network blip shouldn't stop a customer paying.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const r = await fetch(
          "https://challenges.cloudflare.com/turnstile/v0/siteverify",
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
            signal: AbortSignal.timeout(8000),
          },
        );
        ok = Boolean(((await r.json()) as { success?: boolean }).success);
        break;
      } catch (e) {
        // Cloudflare unreachable twice: fail closed, say why.
        console.warn(
          `Turnstile check failed to run (try ${attempt}):`,
          (e as Error).message,
        );
        if (attempt === 2)
          throw new ApiError(
            "We couldn't run the security check. Please try again in a moment.",
            503,
          );
      }
    }
    if (!ok)
      throw new ApiError(
        "The security check didn't pass. Please try again.",
        400,
      );
    return next();
  } catch (e) {
    return next(e);
  }
};
