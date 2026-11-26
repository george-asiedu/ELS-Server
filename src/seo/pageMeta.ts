import { createTenantClient } from "../tenant/tenantClient";
import { env } from "../config/env.config";
import { studioLink } from "../utils/studioLink";
import { S3BucketService } from "../bucket/s3BucketService";

// Server-rendered <head> for a studio's or store's pages.
//
// The web app sets each page's title, description and structured data in the
// browser. Google runs that JavaScript, but link previews (WhatsApp, Facebook,
// X, iMessage) and some search engines do not: they only read the HTML the
// server sends, which is the same index.html for every site. This builds that
// HTML with the right head for the business and page, so a shared link or a
// crawler sees "Bella Beauty Studio · Services and prices" with its photo
// instead of the platform's own title. The page body (the app) is unchanged.
//
// It is served from GET /api/seo/page?path=/services on the business's own
// host; the CDN sends crawler requests for pages there (see deploy/SEO.md).

const { db, raw } = createTenantClient();
const s3 = new S3BucketService();

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const clip = (s: string | null | undefined, n = 160) =>
  (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

// The app's index.html, fetched once and reused for a few minutes.
let template: { html: string; at: number } | null = null;
const TEMPLATE_TTL_MS = 5 * 60 * 1000;
const loadTemplate = async (): Promise<string> => {
  if (template && Date.now() - template.at < TEMPLATE_TTL_MS)
    return template.html;
  const res = await fetch(`${env.clientUrl.replace(/\/$/, "")}/index.html`);
  if (!res.ok) throw new Error(`index.html: HTTP ${res.status}`);
  template = { html: await res.text(), at: Date.now() };
  return template.html;
};

interface PageMeta {
  title: string;
  description: string;
  url: string;
  image: string | null;
  jsonLd: Record<string, unknown> | null;
}

const metaFor = async (
  studioId: string,
  rawPath: string,
): Promise<PageMeta | null> => {
  const studio = await raw.studio.findUnique({
    where: { id: studioId },
    select: {
      name: true,
      slug: true,
      branding: { select: { logoUrl: true } },
      content: {
        select: { aboutText: true, heroImageUrl: true, heroSubtext: true },
      },
      settings: { select: { booking: true } },
    },
  });
  if (!studio) return null;
  const base = studioLink(studio.slug).replace(/\/$/, "");
  const path = rawPath.split("?")[0]!.replace(/\/+$/, "") || "/";
  const url = `${base}${path === "/" ? "/" : path}`;
  const store = studio.settings?.booking === false;
  const contact = await db.contactInfo.findFirst({
    select: { address: true, phone: true, email: true },
  });
  const image =
    s3.deliveryUrl(studio.content?.heroImageUrl ?? null) ??
    s3.deliveryUrl(studio.branding?.logoUrl ?? null);
  const about = clip(studio.content?.aboutText ?? studio.content?.heroSubtext);
  const business = {
    "@context": "https://schema.org",
    "@type": store ? "Store" : "BeautySalon",
    name: studio.name,
    url: `${base}/`,
    ...(about ? { description: about } : {}),
    ...(image ? { image } : {}),
    ...(contact?.phone ? { telephone: contact.phone } : {}),
    ...(contact?.address
      ? {
          address: {
            "@type": "PostalAddress",
            streetAddress: contact.address,
            addressCountry: "GH",
          },
        }
      : {}),
  };
  const page = (
    title: string,
    description: string,
    extra: Partial<PageMeta> = {},
  ): PageMeta => ({
    title: `${title} · ${studio.name}`,
    description: clip(description),
    url,
    image,
    jsonLd: business,
    ...extra,
  });

  // A product page: its own title, photo, price and stock.
  const product = path.match(/^\/shop\/([^/]+)$/);
  if (product && product[1] !== "products") {
    const p = await db.product.findFirst({
      where: { id: product[1]!, active: true },
      select: {
        name: true,
        description: true,
        price: true,
        promoPrice: true,
        imageUrl: true,
        stock: true,
        trackStock: true,
      },
    });
    if (p) {
      const price =
        p.promoPrice !== null && p.promoPrice < p.price
          ? p.promoPrice
          : p.price;
      const photo = s3.deliveryUrl(p.imageUrl) ?? image;
      return {
        title: `${p.name} · ${studio.name}`,
        description: clip(
          p.description ||
            `Buy ${p.name} from ${studio.name} for GHS ${price.toFixed(2)}. Pay by Mobile Money or card.`,
        ),
        url,
        image: photo,
        jsonLd: {
          "@context": "https://schema.org",
          "@type": "Product",
          name: p.name,
          ...(p.description ? { description: clip(p.description, 300) } : {}),
          ...(photo ? { image: photo } : {}),
          brand: { "@type": "Brand", name: studio.name },
          offers: {
            "@type": "Offer",
            url,
            price,
            priceCurrency: "GHS",
            availability:
              !p.trackStock || p.stock > 0
                ? "https://schema.org/InStock"
                : "https://schema.org/OutOfStock",
          },
        },
      };
    }
  }

  switch (path) {
    case "/services": {
      const services = await db.service.findMany({
        where: { active: true },
        select: { name: true, price: true },
        orderBy: { name: "asc" },
        take: 50,
      });
      return page(
        "Services and prices",
        services.length
          ? `${studio.name}: ${services
              .slice(0, 6)
              .map((s) => s.name)
              .join(", ")}. See prices and book online.`
          : `See ${studio.name}'s services and prices, and book online.`,
        {
          jsonLd: {
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: `${studio.name} services and prices`,
            itemListElement: services.map((s, i) => ({
              "@type": "ListItem",
              position: i + 1,
              item: {
                "@type": "Service",
                name: s.name,
                provider: { "@type": "LocalBusiness", name: studio.name },
                offers: {
                  "@type": "Offer",
                  price: s.price,
                  priceCurrency: "GHS",
                },
              },
            })),
          },
        },
      );
    }
    case "/book":
      return page(
        "Book an appointment",
        `Book with ${studio.name} online: choose a service and a free time, and pay by Mobile Money or card.`,
      );
    case "/gallery":
      return page(
        "Gallery",
        `Photos and videos of work by ${studio.name}. See the styles, then book online.`,
      );
    case "/contact":
      return page(
        "Contact and opening hours",
        `How to reach ${studio.name}${contact?.address ? ` at ${contact.address}` : ""}. See opening hours and directions.`,
      );
    case "/gift-cards":
      return page(
        "Gift cards",
        `Give a ${studio.name} gift card. Pay by Mobile Money or card and send it straight to them.`,
      );
    case "/shop":
    case "/shop/products":
      return page(
        "Shop online",
        `Shop online with ${studio.name}. Pay by Mobile Money or card, with delivery or pickup.`,
      );
    default:
      return {
        title: contact?.address
          ? `${studio.name} · ${contact.address}`
          : studio.name,
        description:
          about ||
          (store
            ? `Shop online with ${studio.name}. Pay by Mobile Money or card, with delivery or pickup.`
            : `Book ${studio.name} online and pay by Mobile Money or card.`),
        url,
        image,
        jsonLd: business,
      };
  }
};

/** index.html with this business's head for the given path. */
export const renderPage = async (
  studioId: string | null,
  path: string,
): Promise<string> => {
  const html = await loadTemplate();
  if (!studioId) return html;
  const meta = await metaFor(studioId, path);
  if (!meta) return html;
  const tags = [
    `<meta name="description" content="${esc(meta.description)}" />`,
    `<link rel="canonical" href="${esc(meta.url)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    `<meta property="og:description" content="${esc(meta.description)}" />`,
    `<meta property="og:url" content="${esc(meta.url)}" />`,
    ...(meta.image
      ? [`<meta property="og:image" content="${esc(meta.image)}" />`]
      : []),
    `<meta name="twitter:card" content="${meta.image ? "summary_large_image" : "summary"}" />`,
    `<meta name="twitter:title" content="${esc(meta.title)}" />`,
    `<meta name="twitter:description" content="${esc(meta.description)}" />`,
    ...(meta.jsonLd
      ? [
          // "<" escaped so a business's own text can't close the script.
          `<script type="application/ld+json">${JSON.stringify(meta.jsonLd).replace(/</g, "\\u003c")}</script>`,
        ]
      : []),
  ].join("\n    ");
  return (
    html
      // Drop the platform's own title, description, social and JSON-LD tags.
      .replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(meta.title)}</title>`)
      .replace(
        /\s*<meta\s+(?:name|property)="(?:description|og:[^"]+|twitter:[^"]+)"[\s\S]*?\/?>/gi,
        "",
      )
      .replace(/\s*<link\s+rel="canonical"[^>]*>/gi, "")
      .replace(
        /\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/gi,
        "",
      )
      .replace(/<\/head>/i, `    ${tags}\n  </head>`)
  );
};
