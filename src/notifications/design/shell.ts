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
      <td class="badge badge-${kind}" style="background-color: ${s.bg}; color: ${s.fg}; border-radius: 999px; padding: 6px 16px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; font-weight: 700; letter-spacing: 0.02em;">
        <span class="badge-text" style="margin-right: 6px;">${s.glyph}</span>${esc(label)}
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

// Receipt details for a completed payment. Every payment email carries one so
// the customer has a self-contained record they can keep or forward: who was
// paid, what for, how much, by what method, when, and the reference to quote if
// anything needs chasing up. Rendered as a bordered panel so it reads as a
// receipt rather than as body copy.
export interface ReceiptDetails {
  receiptNumber: string;
  paidOn: string; // pre-formatted date/time
  method?: string | null; // Paystack channel, e.g. "card", "mobile_money"
  reference: string;
  transactionId?: string | null;
  paidTo: string; // studio (or platform) name
  paidToEmail?: string | null;
  amountPaid: string; // pre-formatted, e.g. "GHS 150.00"
  // Set when this payment is a deposit and a balance remains.
  balanceDue?: string | null;
}

const RECEIPT_METHOD_LABELS: Record<string, string> = {
  card: "Card",
  bank: "Bank transfer",
  bank_transfer: "Bank transfer",
  mobile_money: "Mobile money",
  ussd: "USSD",
  qr: "QR",
  eft: "EFT",
  apple_pay: "Apple Pay",
};

export const receiptMethodLabel = (channel?: string | null): string =>
  channel
    ? (RECEIPT_METHOD_LABELS[channel] ??
      channel.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()))
    : "Online payment";

const receiptRow = (label: string, value: string): string => `
    <tr>
      <td class="muted" style="padding: 5px 0; font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: ${MUTED};">${esc(label)}</td>
      <td align="right" style="padding: 5px 0; font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: ${INK}; font-weight: 500;">${esc(value)}</td>
    </tr>`;

// The receipt itself now travels as a PDF attachment, so the body carries only a
// short pointer to it plus the details a customer needs to quote without opening
// anything. Keeping the reference visible matters: some mail clients hide
// attachments behind an extra tap, and support questions start with a reference.
export const receiptAttachedNotice = (
  r: ReceiptDetails,
  color: string,
): string => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0; border: 1px solid ${BORDER}; border-radius: 12px; border-left: 4px solid ${color};">
    <tr>
      <td style="padding: 16px 20px;">
        <p style="margin: 0 0 4px; font-family: Arial, Helvetica, sans-serif; font-size: 14px; font-weight: 700; color: ${INK};">
          📎 Your receipt is attached
        </p>
        <p class="muted" style="margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: ${MUTED}; line-height: 1.6;">
          Receipt no. <strong style="color: ${INK};">${esc(r.receiptNumber)}</strong> &middot; ${esc(r.amountPaid)} paid to ${esc(r.paidTo)} on ${esc(r.paidOn)}.<br />
          Reference: <span style="color: ${INK};">${esc(r.reference)}</span> &middot; paid by ${esc(receiptMethodLabel(r.method))}${
            r.balanceDue
              ? `<br /><span class="accent" style="color: ${EMPHASIS};">Balance due at studio: ${esc(r.balanceDue)}</span>`
              : ""
          }
        </p>
      </td>
    </tr>
  </table>`;

export const receiptBlock = (r: ReceiptDetails, color: string): string => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0; border: 1px solid ${BORDER}; border-radius: 12px; border-top: 3px solid ${color};">
    <tr>
      <td style="padding: 18px 22px 14px;">
        <p style="margin: 0 0 2px; font-family: Georgia, 'Times New Roman', serif; font-size: 15px; font-weight: 700; color: ${INK}; letter-spacing: 0.02em;">
          RECEIPT
        </p>
        <p class="muted" style="margin: 0 0 14px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: ${MUTED};">
          No. ${esc(r.receiptNumber)}
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${receiptRow("Paid to", r.paidTo)}
          ${r.paidToEmail ? receiptRow("Contact", r.paidToEmail) : ""}
          ${receiptRow("Date paid", r.paidOn)}
          ${receiptRow("Payment method", receiptMethodLabel(r.method))}
          ${receiptRow("Reference", r.reference)}
          ${r.transactionId ? receiptRow("Transaction ID", r.transactionId) : ""}
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top: 12px; border-top: 1px solid ${BORDER};">
          <tr>
            <td style="padding: 12px 0 0; font-family: Arial, Helvetica, sans-serif; font-size: 14px; font-weight: 700; color: ${INK};">
              Amount paid
            </td>
            <td class="accent" align="right" style="padding: 12px 0 0; font-family: Arial, Helvetica, sans-serif; font-size: 16px; font-weight: 700; color: ${EMPHASIS};">
              ${esc(r.amountPaid)}
            </td>
          </tr>
          ${
            r.balanceDue
              ? `<tr>
            <td class="muted" style="padding: 6px 0 0; font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: ${MUTED};">Balance due at studio</td>
            <td class="muted" align="right" style="padding: 6px 0 0; font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: ${MUTED};">${esc(r.balanceDue)}</td>
          </tr>`
              : ""
          }
        </table>
        <p class="muted" style="margin: 14px 0 0; font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: ${MUTED}; line-height: 1.5;">
          Keep this receipt for your records. Quote the reference above if you need to ask about this payment.
        </p>
      </td>
    </tr>
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
        <p class="muted" style="margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: ${MUTED};">
          ${esc(args.date)} &middot; ${esc(args.time)}${args.duration ? ` &middot; ${esc(args.duration)}` : ""}
        </p>
        <p class="muted" style="margin: 8px 0 0; font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: ${MUTED};">
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
        ${esc(i.name)} <span class="muted" style="color: ${MUTED};">&times;${i.quantity}</span>
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
      <p class="muted" style="margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: ${MUTED};">
        <a class="muted" href="mailto:${esc(brand.zuri.supportEmail)}" style="color: ${MUTED};">${esc(brand.zuri.supportEmail)}</a>
        &nbsp;&middot;&nbsp;
        <a class="muted" href="${esc(brand.zuri.websiteUrl)}" style="color: ${MUTED};">${esc(brand.zuri.websiteUrl.replace(/^https?:\/\//, ""))}</a>
      </p>`;
  }
  const s = brand.studio;
  const contactLine = [s.phone, s.email].filter(Boolean).join("  &middot;  ");
  return `
      <p style="margin: 0 0 4px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; font-weight: 600; color: ${INK};">${esc(s.name)}</p>
      ${s.address ? `<p class="muted" style="margin: 0 0 2px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: ${MUTED};">${esc(s.address)}</p>` : ""}
      ${contactLine ? `<p class="muted" style="margin: 0 0 10px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: ${MUTED};">${contactLine}</p>` : ""}
      <p class="muted" style="margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: ${MUTED};">Powered by Zuri Studios</p>`;
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
  // Short label shown opposite the brand ("PAYMENT RECEIPT", "BOOKING
  // REQUEST"). Gives the header the two-sided structure of a real document
  // instead of a bare wordmark. Omitted for conversational mail where a
  // document label would be wrong (a welcome note isn't a document).
  documentType?: string;
}): string => {
  const { brand, previewText, bodyHtml, documentType } = args;
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
  /*
   * Dark mode. Every colour in this system is an INLINE style (email clients
   * strip most everything else), and an inline style beats a class — so these
   * rules must use !important and must match by descendant, not by hoping each
   * element carries a class. The previous version defined .email-ink/.email-muted
   * but applied them to nothing, so dark-mode Gmail darkened the background and
   * left the text dark on top of it: invisible.
   */
  @media (prefers-color-scheme: dark) {
    .email-bg { background-color: #1C1416 !important; }
    .email-card {
      background-color: #241A1D !important;
      border-color: #3A2C2F !important;
    }
    /* Body copy inside the card. */
    .email-card td,
    .email-card p,
    .email-card span,
    .email-card div,
    .email-card h1,
    .email-card h2,
    .email-card strong { color: #F3E9EA !important; }
    /* Header and footer sit outside the card, on the page background. */
    .email-outer td,
    .email-outer p,
    .email-outer span,
    .email-outer a { color: #E8DDDF !important; }
    /* Re-establish the hierarchy the blanket rule above flattens. */
    .email-card .muted, .email-outer .muted { color: #B6A2A6 !important; }
    .email-card .accent { color: #F7A8C4 !important; }
    /*
     * The status pill is light-background/dark-text by design, so the blanket
     * rule above would paint its text near-white on a pale pill — invisible.
     * Give it a dark-mode palette of its own instead of exempting it.
     */
    .email-card .badge,
    .email-card .badge .badge-text { color: #14100F !important; }
    .email-card .badge-success { background-color: #7BE0AE !important; }
    .email-card .badge-error { background-color: #FFA8A8 !important; }
    .email-card .badge-warning { background-color: #FFD79A !important; }
    .email-card .badge-info,
    .email-card .badge-pending { background-color: #C9D7F5 !important; }
    /* Hairlines are near-invisible against a dark card otherwise. */
    .email-card table[style*="border"],
    .email-card td[style*="border"] { border-color: #3A2C2F !important; }
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
            <td align="center" class="email-padding email-outer" style="padding: 8px 32px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  ${headerLogo ? `<td style="padding-right: 10px; vertical-align: middle; width: 50px;">${headerLogo}</td>` : ""}
                  <td align="left" style="vertical-align: middle;">
                    ${
                      site
                        ? `<a href="${esc(site)}" target="_blank" style="font-family: Georgia, 'Times New Roman', serif; font-size: 20px; font-weight: 700; color: ${INK}; text-decoration: none;">${esc(name)}</a>`
                        : `<span style="font-family: Georgia, 'Times New Roman', serif; font-size: 20px; font-weight: 700; color: ${INK};">${esc(name)}</span>`
                    }
                  </td>
                  ${
                    documentType
                      ? `<td align="right" style="vertical-align: middle;">
                    <span class="muted" style="font-family: Arial, Helvetica, sans-serif; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; color: ${MUTED}; text-transform: uppercase;">${esc(documentType)}</span>
                  </td>`
                      : ""
                  }
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="padding-top: 14px; border-bottom: 2px solid ${brandColor(brand)}; font-size: 0; line-height: 0;">&nbsp;</td></tr>
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
            <td align="center" class="email-padding email-outer" style="padding: 24px 32px 8px;">
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
