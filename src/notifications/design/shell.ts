import { EmailBrand, MoneyLine } from "../types";

// ---------------------------------------------------------------------------
// Zuri Studios email design system.
//
// Table-based, inline-styled, email-client-safe HTML (Gmail/Outlook/Apple
// Mail/Yahoo all render this reliably — no CSS grid, no JS, no external
// stylesheet). One shared shell + a small set of composable pieces
// (button/badge/money table/appointment card) used by every template in
// notifications/templates/*, so the visual language stays consistent without
// duplicating markup per email. See notifications/README.md.
// ---------------------------------------------------------------------------

const INK = "#2A1B1F"; // deep espresso — body text
const MUTED = "#7A6A6E"; // muted mauve-grey — secondary text
const BORDER = "#EDE3E5";
const IVORY = "#FBF6F3"; // outer background
const CARD = "#FFFFFF";
const EMPHASIS = "#BE185D"; // rose — highlighted totals in money tables

// Escape any data we interpolate (customer names, notes, service names) —
// this is our data, but some of it is free-text a customer typed, and we're
// building raw HTML, not going through a sanitising framework.
export const esc = (v: unknown): string =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string,
  );

const brandName = (brand: EmailBrand) =>
  brand.kind === "studio" ? brand.studio.name : brand.zuri.name;
// The colour templates should use for CTA buttons/appointment-card accents:
// the studio's own brand colour when set, else the Zuri rose.
export const brandColor = (brand: EmailBrand): string =>
  (brand.kind === "studio" && brand.studio.primaryColor) || "#BE185D";
const brandLogo = (brand: EmailBrand) =>
  brand.kind === "studio" ? brand.studio.logoUrl : null;
const brandSiteUrl = (brand: EmailBrand) =>
  (brand.kind === "studio" ? brand.studio.websiteUrl : brand.zuri.websiteUrl) ||
  undefined;

// A bulletproof-enough CTA button: a table cell with background colour and
// padding, degrading gracefully (square corners) on Outlook, which ignores
// border-radius rather than breaking the layout.
export const button = (label: string, url: string, color: string): string => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 28px auto 0;">
    <tr>
      <td style="border-radius: 8px; background-color: ${color};">
        <a href="${esc(url)}" target="_blank"
           style="display: inline-block; padding: 13px 32px; font-family: Arial, Helvetica, sans-serif; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 8px;">
          ${esc(label)}
        </a>
      </td>
    </tr>
  </table>`;

type StatusKind = "success" | "info" | "warning" | "error" | "pending";
const STATUS: Record<StatusKind, { bg: string; fg: string; glyph: string }> = {
  success: { bg: "#E7F5EE", fg: "#1F7A4D", glyph: "&#10003;" }, // ✓
  info: { bg: "#EAF0FE", fg: "#3B5FE0", glyph: "&#8505;" }, // ⓘ
  warning: { bg: "#FDF3E3", fg: "#9A6A16", glyph: "&#33;" }, // !
  error: { bg: "#FBEAEA", fg: "#B23B3B", glyph: "&#10007;" }, // ✗
  pending: { bg: "#F1EEEE", fg: "#7A6A6E", glyph: "&#9675;" }, // ○
};

// Status is always communicated via glyph + label text together, never colour
// alone (accessibility — see notifications/README.md).
export const statusBadge = (kind: StatusKind, label: string): string => {
  const s = STATUS[kind];
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto 20px;">
    <tr>
      <td style="background-color: ${s.bg}; color: ${s.fg}; border-radius: 999px; padding: 6px 16px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; font-weight: 700; letter-spacing: 0.02em;">
        <span style="margin-right: 6px;">${s.glyph}</span>${esc(label)}
      </td>
    </tr>
  </table>`;
};

// A labelled financial breakdown — the ONE place amount formatting/emphasis
// logic lives, reused by payment/order/subscription/settlement-shaped emails.
export const moneyTable = (lines: MoneyLine[]): string => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 20px 0; border-top: 1px solid ${BORDER};">
    ${lines
      .map(
        (l) => `
    <tr>
      <td style="padding: 10px 0; font-family: Arial, Helvetica, sans-serif; font-size: ${l.emphasis ? "16px" : "14px"}; font-weight: ${l.emphasis ? "700" : "400"}; color: ${l.muted ? MUTED : INK}; border-bottom: 1px solid ${BORDER};">
        ${esc(l.label)}
      </td>
      <td align="right" style="padding: 10px 0; font-family: Arial, Helvetica, sans-serif; font-size: ${l.emphasis ? "16px" : "14px"}; font-weight: ${l.emphasis ? "700" : "500"}; color: ${l.emphasis ? EMPHASIS : INK}; border-bottom: 1px solid ${BORDER};">
        ${esc(l.value)}
      </td>
    </tr>`,
      )
      .join("")}
  </table>`;

// A prominent appointment summary card (used by every booking-related email).
export const appointmentCard = (args: {
  serviceName: string;
  date: string;
  time: string;
  duration?: string | null;
  studioName: string;
  color: string;
}): string => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 20px 0; border: 1px solid ${BORDER}; border-radius: 12px; border-left: 4px solid ${args.color};">
    <tr>
      <td style="padding: 20px 24px;">
        <p style="margin: 0 0 4px; font-family: Georgia, 'Times New Roman', serif; font-size: 19px; font-weight: 700; color: ${INK};">
          ${esc(args.serviceName)}
        </p>
        <p style="margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: ${MUTED};">
          ${esc(args.date)} &middot; ${esc(args.time)}${args.duration ? ` &middot; ${esc(args.duration)}` : ""}
        </p>
        <p style="margin: 8px 0 0; font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: ${MUTED};">
          at ${esc(args.studioName)}
        </p>
      </td>
    </tr>
  </table>`;

// A simple product-line table (order confirmations).
export const itemsTable = (
  items: { name: string; quantity: number; total: string }[],
): string => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 16px 0;">
    ${items
      .map(
        (i) => `
    <tr>
      <td style="padding: 6px 0; font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: ${INK};">
        ${esc(i.name)} <span style="color: ${MUTED};">&times;${i.quantity}</span>
      </td>
      <td align="right" style="padding: 6px 0; font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: ${INK};">
        ${esc(i.total)}
      </td>
    </tr>`,
      )
      .join("")}
  </table>`;

const footer = (brand: EmailBrand): string => {
  if (brand.kind === "zuri") {
    return `
      <p style="margin: 0 0 4px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; font-weight: 600; color: ${INK};">Zuri Studios</p>
      <p style="margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: ${MUTED};">
        <a href="mailto:${esc(brand.zuri.supportEmail)}" style="color: ${MUTED};">${esc(brand.zuri.supportEmail)}</a>
        &nbsp;&middot;&nbsp;
        <a href="${esc(brand.zuri.websiteUrl)}" style="color: ${MUTED};">${esc(brand.zuri.websiteUrl.replace(/^https?:\/\//, ""))}</a>
      </p>`;
  }
  const s = brand.studio;
  const contactLine = [s.phone, s.email].filter(Boolean).join("  &middot;  ");
  return `
      <p style="margin: 0 0 4px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; font-weight: 600; color: ${INK};">${esc(s.name)}</p>
      ${s.address ? `<p style="margin: 0 0 2px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: ${MUTED};">${esc(s.address)}</p>` : ""}
      ${contactLine ? `<p style="margin: 0 0 10px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: ${MUTED};">${contactLine}</p>` : ""}
      <p style="margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: ${MUTED};">Powered by Zuri Studios</p>`;
};

/**
 * Wraps a template's inner content in the shared shell: brand header, the
 * content passed in, and a brand-appropriate footer. Every template in
 * notifications/templates/* renders through this, so studio-branded and
 * Zuri-branded mail look distinct but structurally consistent.
 */
export const renderShell = (args: {
  brand: EmailBrand;
  previewText: string;
  bodyHtml: string;
}): string => {
  const { brand, previewText, bodyHtml } = args;
  const name = brandName(brand);
  const logo = brandLogo(brand);
  const site = brandSiteUrl(brand);

  const headerLogo = logo
    ? `<img src="${esc(logo)}" alt="${esc(name)}" width="40" height="40" style="border-radius: 8px; display: block;" />`
    : "";

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<title>${esc(name)}</title>
<!--[if mso]>
<style>table {border-collapse: collapse;} .fallback-font {font-family: Arial, sans-serif !important;}</style>
<![endif]-->
<style>
  body { margin: 0; padding: 0; background-color: ${IVORY}; }
  img { border: 0; outline: none; text-decoration: none; }
  a { color: inherit; }
  @media (max-width: 620px) {
    .email-container { width: 100% !important; }
    .email-padding { padding-left: 20px !important; padding-right: 20px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .email-bg { background-color: #1C1416 !important; }
    .email-card { background-color: #241A1D !important; }
    .email-ink { color: #F3E9EA !important; }
    .email-muted { color: #B6A2A6 !important; }
    .email-border { border-color: #3A2C2F !important; }
  }
</style>
</head>
<body class="email-bg" style="margin:0; padding:0; background-color: ${IVORY};">
  <!-- Preheader (hidden, sets the inbox preview text) -->
  <div style="display:none; max-height:0; overflow:hidden; opacity:0;">${esc(previewText)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-bg" style="background-color: ${IVORY};">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="width: 600px; max-width: 100%;">
          <!-- Header -->
          <tr>
            <td align="center" class="email-padding" style="padding: 8px 32px 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  ${headerLogo ? `<td style="padding-right: 10px; vertical-align: middle;">${headerLogo}</td>` : ""}
                  <td style="vertical-align: middle;">
                    ${
                      site
                        ? `<a href="${esc(site)}" target="_blank" style="font-family: Georgia, 'Times New Roman', serif; font-size: 20px; font-weight: 700; color: ${INK}; text-decoration: none;">${esc(name)}</a>`
                        : `<span style="font-family: Georgia, 'Times New Roman', serif; font-size: 20px; font-weight: 700; color: ${INK};">${esc(name)}</span>`
                    }
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Card -->
          <tr>
            <td class="email-card email-padding" style="background-color: ${CARD}; border: 1px solid ${BORDER}; border-radius: 16px; padding: 36px 40px;">
              ${bodyHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td align="center" class="email-padding" style="padding: 24px 32px 8px;">
              ${footer(brand)}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};
