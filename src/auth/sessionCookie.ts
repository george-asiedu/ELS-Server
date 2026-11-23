import { Request, Response, CookieOptions } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.config";

// The session lives in an HttpOnly cookie, out of reach of page scripts. Each
// studio (and the platform console) has its own cookie on the API's host, so
// being signed in to one never replaces the session for another.
const name = (slug: string | null) =>
  slug ? `zuri_s_${slug}` : "zuri_platform";

const slugFrom = (req: Request): string | null => {
  const header = req.headers["x-studio-slug"];
  if (typeof header !== "string") return null;
  const slug = header.trim().toLowerCase();
  return /^[a-z0-9-]{1,64}$/.test(slug) ? slug : null;
};

const options = (): CookieOptions => ({
  httpOnly: true,
  // Development may be cross-site (Vercel + Render), which needs "none".
  sameSite: env.cookieSameSite,
  secure: env.nodeEnv === "production" || env.cookieSameSite === "none",
  path: "/api",
});

export const readSessionCookie = (req: Request): string | null => {
  const wanted = name(slugFrom(req));
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === wanted) {
      return decodeURIComponent(part.slice(at + 1).trim());
    }
  }
  return null;
};

/** `slug` overrides the request's studio (impersonating another studio). */
export const setSessionCookie = (
  req: Request,
  res: Response,
  accessToken: string,
  slug?: string,
) => {
  const decoded = jwt.decode(accessToken);
  const exp =
    decoded && typeof decoded !== "string" && decoded.exp ? decoded.exp : 0;
  res.cookie(name(slug ?? slugFrom(req)), accessToken, {
    ...options(),
    maxAge: Math.max(0, exp * 1000 - Date.now()),
  });
};

export const clearSessionCookie = (req: Request, res: Response) => {
  res.clearCookie(name(slugFrom(req)), options());
};

/** Put the token in the cookie and take it out of the reply body. */
export const withoutToken = <T extends { data?: unknown }>(
  req: Request,
  res: Response,
  result: T,
): T => {
  const data = result.data as { token?: { accessToken: string } } | undefined;
  if (data?.token) {
    setSessionCookie(req, res, data.token.accessToken);
    const { token: _token, ...rest } = data;
    return { ...result, data: rest };
  }
  return result;
};
