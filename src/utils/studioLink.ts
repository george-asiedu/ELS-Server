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
  if (env.rootDomain) {
    // ROOT_DOMAIN may be written with a scheme ("http://localhost:8080" in
    // development); keep its scheme and port, otherwise use https.
    const m = /^(https?):\/\/(.+)$/.exec(env.rootDomain.replace(/\/$/, ""));
    const scheme = m ? m[1] : "https";
    const host = m ? m[2] : env.rootDomain.replace(/\/$/, "");
    return `${scheme}://${slug}.${host}${page}`;
  }
  const entry = `${env.clientUrl.replace(/\/$/, "")}/s/${slug}`;
  return page ? `${entry}?next=${encodeURIComponent(page)}` : entry;
};
