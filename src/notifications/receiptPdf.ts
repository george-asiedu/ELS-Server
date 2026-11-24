import { jsPDF } from "jspdf";

// Server-side receipt PDF, attached to every payment email. Laid out like the
// booking confirmation: a coloured header with the business's initial, status
// pills, cream panels with an accent edge, a charges table and a totals bar.
//
// Colours are dynamic: a studio/shop's own primary colour drives the header,
// accents and totals bar; without one the receipt uses Zuri's ink and yellow.
// Text colour on coloured areas is picked from the colour's brightness, so it
// stays readable whatever the owner chose.
//
// jsPDF runs fine under Node for text/vector output — no canvas or DOM shim is
// needed because we never rasterise an image here.

type RGB = [number, number, number];

const ZURI_INK: RGB = [16, 23, 32];
const ZURI_YELLOW: RGB = [251, 197, 0];
const PANEL: RGB = [245, 244, 240];
const RULE: RGB = [225, 225, 228];
const GREY: RGB = [107, 114, 128];
const DARK: RGB = [31, 41, 55];
const GREEN: RGB = [22, 125, 75];
const GREEN_BG: RGB = [222, 241, 229];
const RED: RGB = [196, 30, 45];
const RED_BG: RGB = [253, 226, 226];
const AMBER: RGB = [146, 95, 0];
const AMBER_BG: RGB = [254, 243, 205];

export interface ReceiptLine {
  label: string;
  value: string;
  strong?: boolean;
}

export interface ReceiptPdfInput {
  // Header
  studioName: string;
  // Optional line under the name, e.g. "Accra, Greater Accra".
  subtitle?: string | null | undefined;
  primaryColor?: string | null | undefined;
  title: string; // e.g. "Payment receipt"
  receiptNumber: string;
  issuedAt: Date;

  // What was bought
  heading: string; // service or order name
  lines: ReceiptLine[];

  // Money
  amountPaid: string; // pre-formatted, e.g. "GHS 150.00"
  balanceDue?: string | null | undefined;

  // Provenance
  reference: string | null;
  transactionId?: string | null | undefined;
  paymentMethod: string;
  paidToEmail?: string | null | undefined;
  status: "PAID" | "PARTIALLY_PAID";
}

const hexToRgb = (hex: string | null | undefined): RGB | null => {
  const m = hex?.match(/^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  return m
    ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)]
    : null;
};

const luminance = ([r, g, b]: RGB) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
// White on dark colours, ink on light ones.
const onColor = (c: RGB): RGB => (luminance(c) > 0.6 ? ZURI_INK : [255, 255, 255]);
// A lighter tint of a colour, for the logo tile.
const tint = (c: RGB, amount: number): RGB => [
  Math.round(c[0] + (255 - c[0]) * amount),
  Math.round(c[1] + (255 - c[1]) * amount),
  Math.round(c[2] + (255 - c[2]) * amount),
];

// Dates are formatted in UTC: Ghana is UTC year-round, so this is the
// customer's own local time without pulling in a timezone database.
const fmtDate = (d: Date): string =>
  d.toLocaleString("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

export interface GeneratedPdf {
  filename: string;
  base64: string;
  bytes: number;
}

export const buildReceiptPdf = (input: ReceiptPdfInput): GeneratedPdf => {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const left = 48;
  const right = pageWidth - 48;
  const width = right - left;

  const custom = hexToRgb(input.primaryColor);
  const band: RGB = custom ?? ZURI_INK;
  const accent: RGB = custom ?? ZURI_YELLOW;
  const bandText = onColor(band);
  const accentText = onColor(accent);

  // ---- Header band: logo tile + name on the left, receipt details right ----
  doc.setFillColor(...band);
  doc.rect(0, 0, pageWidth, 128, "F");

  doc.setFillColor(...(custom ? tint(band, 0.25) : accent));
  doc.rect(left, 34, 56, 56, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(26);
  doc.setTextColor(...(custom ? bandText : accentText));
  doc.text(input.studioName.trim().charAt(0).toUpperCase() || "Z", left + 28, 70, {
    align: "center",
  });

  doc.setFontSize(21);
  doc.setTextColor(...bandText);
  doc.text(input.studioName, left + 74, input.subtitle ? 58 : 68, {
    maxWidth: width - 74 - 190,
  });
  if (input.subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(input.subtitle, left + 74, 77, { maxWidth: width - 74 - 190 });
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(input.title.toUpperCase(), right, 48, { align: "right" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(19);
  doc.text(input.receiptNumber, right, 72, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(fmtDate(input.issuedAt), right, 90, { align: "right" });

  // ---- Status pills ----
  let y = 152;
  const pill = (text: string, fg: RGB, bg: RGB, x: number): number => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    const w = doc.getTextWidth(text) + 26;
    doc.setFillColor(...bg);
    doc.rect(x, y, w, 24, "F");
    doc.setTextColor(...fg);
    doc.text(text, x + 13, y + 16);
    return x + w + 10;
  };
  const paidInFull = input.status === "PAID";
  let px = pill(
    paidInFull ? "PAID IN FULL" : "DEPOSIT PAID",
    paidInFull ? GREEN : AMBER,
    paidInFull ? GREEN_BG : AMBER_BG,
    left,
  );
  if (input.balanceDue) pill("BALANCE DUE", RED, RED_BG, px);
  y += 44;

  // A cream panel with an accent edge; `draw` paints inside it.
  const panel = (h: number, draw: (x: number, top: number) => void) => {
    doc.setFillColor(...PANEL);
    doc.rect(left, y, width, h, "F");
    doc.setFillColor(...accent);
    doc.rect(left, y, 4, h, "F");
    draw(left + 22, y);
    y += h + 16;
  };
  const label = (text: string, x: number, top: number) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...GREY);
    doc.text(text, x, top);
  };

  // ---- What this is for ----
  panel(70, (x, top) => {
    label("RECEIPT FOR", x, top + 24);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.setTextColor(...DARK);
    doc.text(input.heading, x, top + 50, { maxWidth: width - 44 });
  });

  // ---- Details table ----
  const sectionTitle = (text: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...GREY);
    doc.text(text, left, y + 4);
    const tw = doc.getTextWidth(text);
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.75);
    doc.line(left + tw + 12, y + 1, right, y + 1);
    y += 16;
  };
  sectionTitle("DETAILS");
  doc.setFillColor(238, 237, 233);
  doc.rect(left, y, width, 26, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...GREY);
  doc.text("DESCRIPTION", left + 14, y + 17);
  doc.text("DETAIL", right - 14, y + 17, { align: "right" });
  y += 26;
  for (const l of input.lines) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...DARK);
    doc.text(l.label, left + 14, y + 20);
    doc.setFont("helvetica", l.strong ? "bold" : "normal");
    doc.text(l.value, right - 14, y + 20, {
      align: "right",
      maxWidth: width - 160,
    });
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.5);
    doc.line(left, y + 31, right, y + 31);
    y += 32;
  }
  y += 18;

  // ---- Payment panel (left) and totals (right) ----
  const colGap = 16;
  const half = (width - colGap) / 2;
  const top = y;
  const provenance: [string, string][] = [
    ["Payment method", input.paymentMethod],
    ["Reference", input.reference ?? "Not available"],
    ...(input.transactionId
      ? ([["Transaction ID", input.transactionId]] as [string, string][])
      : []),
    ...(input.paidToEmail
      ? ([["Paid to", input.paidToEmail]] as [string, string][])
      : []),
  ];
  const panelH = 34 + provenance.length * 30;
  doc.setFillColor(...PANEL);
  doc.rect(left, top, half, panelH, "F");
  doc.setFillColor(...accent);
  doc.rect(left, top, 4, panelH, "F");
  label("PAYMENT", left + 20, top + 22);
  provenance.forEach(([k, v], i) => {
    const ry = top + 44 + i * 30;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...GREY);
    doc.text(k, left + 20, ry);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...DARK);
    doc.text(v, left + 20, ry + 12, { maxWidth: half - 36 });
  });

  const tx = left + half + colGap;
  let ty = top + 6;
  if (input.balanceDue) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(...RED);
    doc.text("Balance due", tx + 6, ty + 14);
    doc.text(input.balanceDue, right - 6, ty + 14, { align: "right" });
    ty += 30;
  }
  doc.setFillColor(...band);
  doc.rect(tx, ty, half, 50, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...bandText);
  doc.text("Amount paid", tx + 16, ty + 30);
  doc.setFontSize(17);
  doc.text(input.amountPaid, right - 16, ty + 31, { align: "right" });

  // ---- Footer ----
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.75);
  doc.line(left, pageHeight - 66, right, pageHeight - 66);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...GREY);
  doc.text(input.studioName, left, pageHeight - 50);
  doc.text(
    "Keep this receipt for your records. Quote the reference if you need to ask about this payment.",
    left,
    pageHeight - 37,
    { maxWidth: width - 90 },
  );
  doc.text("Page 1 of 1", right, pageHeight - 50, { align: "right" });

  const buf = Buffer.from(doc.output("arraybuffer") as ArrayBuffer);
  // Filename is part of an email header, so strip anything that could break it
  // (Plunk rejects newlines and quotes) or confuse a filesystem.
  const safeNumber = input.receiptNumber.replace(/[^A-Za-z0-9_-]/g, "");
  return {
    filename: `receipt-${safeNumber || "payment"}.pdf`,
    base64: buf.toString("base64"),
    bytes: buf.length,
  };
};
