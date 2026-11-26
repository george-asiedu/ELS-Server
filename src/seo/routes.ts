import { Request, Response, Router } from "express";
import { renderPage } from "./pageMeta";
import { createTenantClient } from "../tenant/tenantClient";
import { getTenantContext, runWithTenant } from "../tenant/context";
import {
  resolveStudioByDomain,
  resolveStudioBySlug,
} from "../tenant/studioResolver";
import { env } from "../config/env.config";
import { studioLink } from "../utils/studioLink";

// Sitemap and robots.txt for search engines. On a studio's site they list its
// own pages and products; on the platform, its public pages. In production the
// CDN sends /sitemap.xml and /robots.txt on every site to these (see
// deploy/README).

const { db, raw } = createTenantClient();
const router: Router = Router();

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const siteBase = async () => {
  const studioId = getTenantContext()?.studioId;
  if (!studioId)
    return { studioId: null, base: env.clientUrl.replace(/\/$/, "") };
  const studio = await raw.studio.findUnique({
    where: { id: studioId },
    select: { slug: true },
  });
  return {
    studioId,
    base: studio
      ? studioLink(studio.slug).replace(/\/$/, "")
      : env.clientUrl.replace(/\/$/, ""),
  };
};

router.get("/sitemap.xml", async (_req: Request, res: Response) => {
  const { studioId, base } = await siteBase();
  const urls: { loc: string; lastmod?: Date }[] = [];
  if (!studioId) {
    for (const p of ["/", "/discover", "/onboarding"])
      urls.push({ loc: `${base}${p}` });
  } else {
    const settings = await db.studioSettings.findFirst({
      select: { booking: true, commerce: true, gallery: true },
    });
    const booking = settings?.booking !== false;
    const pages = booking
      ? [
          "/",
          "/services",
          "/book",
          "/contact",
          "/gift-cards",
          ...(settings?.gallery !== false ? ["/gallery"] : []),
          ...(settings?.commerce ? ["/shop", "/shop/products"] : []),
        ]
      : ["/", "/shop/products", "/gift-cards"];
    for (const p of pages) urls.push({ loc: `${base}${p}` });
    if (settings?.commerce || !booking) {
      const products = await db.product.findMany({
        where: { active: true },
        select: { id: true, updatedAt: true },
        take: 5000,
      });
      for (const p of products)
        urls.push({ loc: `${base}/shop/${p.id}`, lastmod: p.updatedAt });
    }
  }
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url><loc>${xmlEscape(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod.toISOString().slice(0, 10)}</lastmod>` : ""}</url>`,
  )
  .join("\n")}
</urlset>`;
  res
    .set("Cache-Control", "public, max-age=3600")
    .type("application/xml")
    .send(body);
});

router.get("/robots.txt", async (_req: Request, res: Response) => {
  const { base } = await siteBase();
  res
    .set("Cache-Control", "public, max-age=3600")
    .type("text/plain")
    .send(
      `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /account\nDisallow: /platform\nDisallow: /cart\nDisallow: /checkout\n\nSitemap: ${base}/sitemap.xml\n`,
    );
});

// The app's HTML with this business's title, description, preview image and
// structured data in the head, for crawlers and link previews that do not run
// JavaScript (see seo/pageMeta.ts and deploy/SEO.md).
// The CDN calls this for crawlers with ?host= (the site they asked for) and
// ?path=. The studio comes from that host: a subdomain of the platform or a
// verified custom domain. Unknown hosts get the plain index.html.
const studioForHost = async (host: string) => {
  const h = host.trim().toLowerCase().replace(/:\d+$/, "");
  if (!h) return null;
  if (env.rootDomain && h.endsWith(`.${env.rootDomain}`)) {
    const sub = h.slice(0, -(env.rootDomain.length + 1));
    return sub && sub !== "www" ? resolveStudioBySlug(sub) : null;
  }
  return resolveStudioByDomain(h);
};

router.get("/page", async (req: Request, res: Response) => {
  const path = typeof req.query.path === "string" ? req.query.path : "/";
  const host =
    typeof req.query.host === "string" ? req.query.host.slice(0, 253) : "";
  try {
    const studio = await studioForHost(host);
    const safePath = path.startsWith("/") ? path.slice(0, 300) : "/";
    // Scoped to that studio, so its own services and products are read.
    const html =
      studio && studio.status !== "SUSPENDED"
        ? await runWithTenant({ studioId: studio.id, superAdmin: false }, () =>
            renderPage(studio.id, safePath),
          )
        : await renderPage(null, safePath);
    res
      .set("Cache-Control", "public, max-age=600")
      .type("text/html")
      .send(html);
  } catch (error) {
    console.error("SEO page render failed:", (error as Error).message);
    res.status(502).type("text/plain").send("Page unavailable");
  }
});

export default router;
