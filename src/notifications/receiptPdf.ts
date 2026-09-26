import { jsPDF } from "jspdf";

// Server-side receipt PDF, attached to every payment email. Mirrors the layout
// of the receipt the customer can download in the app (web: src/lib/receipt.ts)
// so the emailed copy and the downloaded copy look like the same document.
//
// jsPDF runs fine under Node for text/vector output — no canvas or DOM shim is
// needed because we never rasterise an image here.

const PINK: RGB = [190, 24, 93];
const GREY: RGB = [107, 114, 128];
const DARK: RGB = [31, 41, 55];
const GREEN: RGB = [22, 125, 75];
const RED: RGB = [180, 45, 55];

type RGB = [number, number, number];

export interface ReceiptLine {
  label: string;
  value: string;
  strong?: boolean;
}

export interface ReceiptPdfInput {
  // Header
  studioName: string;
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

const hexToRgb = (hex: string | null | undefined, fallback: RGB): RGB => {
  const m = hex?.match(/^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  return m
    ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)]
    : fallback;
};

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
  const left = 48;
  const right = pageWidth - 48;
  const color = hexToRgb(input.primaryColor, PINK);

  // ---- Header ----
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...color);
  doc.text(input.studioName, left, 62);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...GREY);
  doc.text(input.title.toUpperCase(), left, 82);

  doc.setFontSize(9);
  doc.text(`Receipt no: ${input.receiptNumber}`, right, 62, { align: "right" });
  doc.text(`Issued: ${fmtDate(input.issuedAt)}`, right, 77, { align: "right" });

  doc.setDrawColor(...color);
  doc.setLineWidth(1.25);
  doc.line(left, 98, right, 98);

  // ---- Status ----
  let y = 126;
  const paidInFull = input.status === "PAID";
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...(paidInFull ? GREEN : DARK));
  doc.text(
    `STATUS  ·  ${paidInFull ? "PAID IN FULL" : "DEPOSIT PAID"}`,
    left,
    y,
  );
  y += 30;

  // ---- What this is for ----
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...DARK);
  doc.text(input.heading, left, y, { maxWidth: right - left });
  y += 32;

  const row = (label: string, value: string, strong = false) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...GREY);
    doc.text(label, left, y);
    doc.setFont("helvetica", strong ? "bold" : "normal");
    doc.setTextColor(...DARK);
    doc.text(value, right, y, {
      align: "right",
      maxWidth: right - left - 130,
    });
    y += 23;
  };

  for (const l of input.lines) row(l.label, l.value, l.strong);

  // ---- Amount paid, set apart ----
  y += 8;
  doc.setDrawColor(225, 225, 228);
  doc.setLineWidth(0.75);
  doc.line(left, y, right, y);
  y += 26;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...DARK);
  doc.text("Amount paid", left, y);
  doc.setFontSize(16);
  doc.setTextColor(...color);
  doc.text(input.amountPaid, right, y, { align: "right" });
  y += 26;

  if (input.balanceDue) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...RED);
    doc.text("Balance due at studio", left, y);
    doc.text(input.balanceDue, right, y, { align: "right" });
    y += 24;
  }

  // ---- Provenance ----
  y += 14;
  doc.setDrawColor(225, 225, 228);
  doc.line(left, y, right, y);
  y += 24;

  row("Payment method", input.paymentMethod);
  row("Reference", input.reference ?? "Not available");
  if (input.transactionId) row("Transaction ID", input.transactionId);
  if (input.paidToEmail) row("Paid to", input.paidToEmail);

  // ---- Footer ----
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...GREY);
  doc.text(
    "Keep this receipt for your records. Quote the reference above if you need to ask about this payment.",
    left,
    doc.internal.pageSize.getHeight() - 52,
    { maxWidth: right - left },
  );

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
