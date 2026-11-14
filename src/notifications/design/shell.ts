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
const EMPHASIS = "#947400"; // Zuri yellow, darkened to read on white — highlighted totals

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
// the studio's own brand colour when set, else the Zuri cranberry pink.
export const brandColor = (brand: EmailBrand): string =>
  (brand.kind === "studio" && brand.studio.primaryColor) || "#FBC500";
// The Zuri mark, served from the public site's /public folder. Email clients
// need an absolute URL, and PNG rather than SVG.
const ZURI_LOGO_URL = "https://zuristudios.com/zuri-mark-square.png";
const brandLogo = (brand: EmailBrand) =>
  brand.kind === "studio" ? brand.studio.logoUrl : ZURI_LOGO_URL;
const brandSiteUrl = (brand: EmailBrand) =>
  (brand.kind === "studio" ? brand.studio.websiteUrl : brand.zuri.websiteUrl) ||
  undefined;

// A bulletproof-enough CTA button: a table cell with background colour and
// padding, degrading gracefully (square corners) on Outlook, which ignores
// border-radius rather than breaking the layout.
// Ink or white text, whichever reads better on the button colour.
const textOn = (hex: string): string => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const [r, g, b] = [0, 2, 4].map(
    (i) => parseInt(m[1]!.slice(i, i + 2), 16) / 255,
  );
  const lin = (c: number) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const L = 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
  return (L + 0.05) / 0.0614 > 1.05 / (L + 0.05) ? "#101720" : "#ffffff";
};

// One solid block button, centred (as in the Westend City Church emails). The
// data-cta marker lets the shell repeat the link under "Button not working?".
export const button = (label: string, url: string, color: string): string => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin: 28px auto;">
    <tr>
      <td align="center" bgcolor="${color}" style="background: ${color};">
        <a href="${esc(url)}" target="_blank" data-cta="1"
           style="display: inline-block; padding: 14px 48px; font-family: Arial, Helvetica, sans-serif; font-size: 15px; font-weight: bold; color: ${textOn(color)}; text-decoration: none;">${esc(label)}</a>
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
          Your receipt is attached
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

const PAGE = "#F2F3F3";
const BAND = "#16191F";
const SOFT = "#545B64";
const FAINT = "#7D8998";

// The line under the divider: how to get help, in the brand's own words.
const supportLine = (brand: EmailBrand): string => {
  if (brand.kind === "zuri")
    return `Need a hand with anything? Just reply to this email or write to <a href="mailto:${esc(brand.zuri.supportEmail)}" style="color: #0972D3;">${esc(brand.zuri.supportEmail)}</a> and our team will get back to you.`;
  const s = brand.studio;
  const ways = [s.phone ? esc(s.phone) : null, s.email ? `<a href="mailto:${esc(s.email)}" style="color: #0972D3;">${esc(s.email)}</a>` : null].filter(Boolean);
  return `Questions? Just reply to this email${ways.length ? ` or contact ${esc(s.name)} on ${ways.join(" or ")}` : ""}.`;
};

// The small grey footer under the card.
const legalFooter = (brand: EmailBrand): string => {
  if (brand.kind === "zuri")
    return `Zuri Studios &middot; <a href="${esc(brand.zuri.websiteUrl)}" style="color: ${FAINT};">${esc(brand.zuri.websiteUrl.replace(/^https?:\/\//, ""))}</a><br>You're getting this email because of something on your account.`;
  const s = brand.studio;
  return `${esc(s.name)}${s.address ? ` &middot; ${esc(s.address)}` : ""}<br>Powered by Zuri Studios. You're getting this email because of something on your account.`;
};

/**
 * Wraps a template's content in the shared layout, modelled on the Westend City
 * Church emails: a dark header band with the logo and name, a white card with
 * left-aligned text and one block button, a sign-off, a support line and the
 * button's link under a divider, and a small grey footer. Table-based with
 * inline styles so it looks the same in Gmail, Outlook and Apple Mail.
 */
export const renderShell = (args: {
  brand: EmailBrand;
  previewText: string;
  bodyHtml: string;
  // Short label shown in the header band ("Payment receipt"). Omitted for
  // conversational mail.
  documentType?: string;
}): string => {
  const { brand, previewText, documentType } = args;
  const name = brandName(brand);
  const logo = brandLogo(brand);
  const site = brandSiteUrl(brand);
  // Templates were written centred; this layout reads left-aligned, in one
  // sans-serif face, like the church emails.
  const bodyHtml = args.bodyHtml
    .replace(/text-align:\s*center;?/g, "text-align: left;")
    .replace(/margin: 0 auto 20px;/g, "margin: 0 0 20px;")
    .replace(/font-family: Georgia, serif; font-size: 22px;/g, "font-family: Arial, Helvetica, sans-serif; font-size: 20px; font-weight: bold;");
  const cta = /<a href="([^"]+)"[^>]*data-cta="1"/.exec(bodyHtml)?.[1];

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<title>${esc(name)}</title>
<style>
  body { margin: 0; padding: 0; background-color: ${PAGE}; }
  img { border: 0; outline: none; text-decoration: none; }
  @media (max-width: 620px) {
    .email-container { width: 100% !important; }
    .email-padding { padding-left: 20px !important; padding-right: 20px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .email-bg { background-color: #0F1114 !important; }
    .email-card { background-color: #1B1E23 !important; }
    .email-card td, .email-card p, .email-card span, .email-card div, .email-card h1, .email-card h2, .email-card strong { color: #E9ECEF !important; }
    .email-card .muted { color: #A3ACB7 !important; }
    .email-card table[style*="border"], .email-card td[style*="border"] { border-color: #2C3138 !important; }
  }
</style>
</head>
<body class="email-bg" style="margin: 0; padding: 0; background-color: ${PAGE}; font-family: Arial, Helvetica, sans-serif;">
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">${esc(previewText)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-bg" bgcolor="${PAGE}" style="background: ${PAGE};">
    <tr>
      <td align="center" style="padding: 24px 12px;">
        <table role="presentation" class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 600px;">
          <!-- Header band -->
          <tr>
            <td bgcolor="${BAND}" class="email-padding" style="background: ${BAND}; padding: 20px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="vertical-align: middle;">
                    ${logo ? `<img src="${esc(logo)}" width="44" height="44" alt="" style="display: inline-block; vertical-align: middle; border-radius: 50%; background: #ffffff;" />` : ""}
                    ${
                      site
                        ? `<a href="${esc(site)}" target="_blank" style="display: inline-block; vertical-align: middle; ${logo ? "margin-left: 12px; " : ""}color: #ffffff; font-size: 18px; font-weight: bold; letter-spacing: 0.3px; text-decoration: none;">${esc(name)}</a>`
                        : `<span style="display: inline-block; vertical-align: middle; ${logo ? "margin-left: 12px; " : ""}color: #ffffff; font-size: 18px; font-weight: bold; letter-spacing: 0.3px;">${esc(name)}</span>`
                    }
                  </td>
                  ${documentType ? `<td align="right" style="vertical-align: middle; color: #AEB5BF; font-size: 12px;">${esc(documentType)}</td>` : ""}
                </tr>
              </table>
            </td>
          </tr>
          <!-- Card -->
          <tr>
            <td bgcolor="#ffffff" class="email-card email-padding" style="background: #ffffff; padding: 32px 32px 8px; font-size: 15px; line-height: 1.55; color: #333333;">
              ${bodyHtml}
              <p style="margin: 28px 0 0; font-size: 15px; line-height: 1.55; color: #333333;">Kind regards,</p>
              <p style="margin: 2px 0 24px; font-size: 16px; line-height: 1.5; color: ${BAND};">${esc(name)}</p>
            </td>
          </tr>
          <tr>
            <td bgcolor="#ffffff" class="email-card" style="background: #ffffff; padding: 0 32px;"><div style="border-top: 1px solid #E3E6E8; font-size: 0; line-height: 0;">&nbsp;</div></td>
          </tr>
          <tr>
            <td bgcolor="#ffffff" class="email-card email-padding" style="background: #ffffff; padding: 20px 32px 28px; font-size: 12px; line-height: 1.5; color: ${SOFT};">
              ${supportLine(brand)}
              ${cta ? `<br><br><span class="muted" style="color: ${FAINT};">Button not working? Paste this link into your browser:<br><a href="${cta}" style="color: #0972D3; word-break: break-all;">${cta}</a></span>` : ""}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td align="center" style="padding: 20px 24px; font-size: 11px; line-height: 1.5; color: ${FAINT};">
              ${legalFooter(brand)}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};
