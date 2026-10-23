import { env } from "../config/env.config";

/**
 * A link to a page of one studio's site, for emails and payment redirects.
 * Admin and customer accounts belong to a studio and are signed in on that
 * studio's address, so these links must go there, not to the platform's.
 *
 * Production: https://<slug>.<ROOT_DOMAIN><path>. Without a root domain
 * (local dev), the /s/<slug> entry link picks the studio, then continues to
 * `path`.
 */
export const studioLink = (slug: string, path = ""): string => {
  const page = path && !path.startsWith("/") ? `/${path}` : path;
  if (env.rootDomain) return `https://${slug}.${env.rootDomain}${page}`;
  const entry = `${env.clientUrl.replace(/\/$/, "")}/s/${slug}`;
  return page ? `${entry}?next=${encodeURIComponent(page)}` : entry;
};
