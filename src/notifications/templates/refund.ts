import {
  renderShell,
  button,
  esc,
  statusBadge,
  moneyTable,
  brandColor,
  receiptAttachedNotice,
  ReceiptDetails,
} from "../design/shell";
import { EmailBrand, MoneyLine } from "../types";

/**
 * Refund confirmation, for a booking payment or a shop order.
 *
 * One template covers full and partial refunds: the difference is real money
 * (how much is coming back, how much the customer still paid) rather than a
 * different document, and `isPartial` drives the wording and status so a
 * customer is never told "refunded" when only part of it was.
 */
export const refundProcessed = (
  brand: EmailBrand,
  data: {
    customerFirstName?: string;
    // What was refunded — "your Kinky Locks appointment", "order ORD-1042".
    subject: string;
    isPartial: boolean;
    // Original paid / refunded now / still paid (when partial).
    lines: MoneyLine[];
    refundAmount: string;
    reason?: string | null;
    receipt: ReceiptDetails;
    viewUrl?: string;
  },
) => {
  const color = brandColor(brand);
  return {
    subject: data.isPartial
      ? "Your partial refund has been processed"
      : "Your refund has been processed",
    html: renderShell({
      brand,
      previewText: `${data.refundAmount} is on its way back to you.`,
      documentType: data.isPartial ? "Partial refund" : "Refund",
      bodyHtml: `
        ${statusBadge("success", data.isPartial ? "PARTIALLY REFUNDED" : "REFUNDED")}
        <h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F; text-align: center;">
          ${data.customerFirstName ? `${esc(data.customerFirstName)}, your refund is on its way` : "Your refund is on its way"}
        </h1>
        <p style="margin: 0; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; line-height: 1.6; text-align: center;">
          We've refunded <strong>${esc(data.refundAmount)}</strong> for ${esc(data.subject)}.
          It goes back to the way you paid, and usually lands within 5–10 business days
          depending on your bank.
        </p>
        ${data.reason ? `<p class="muted" style="margin: 12px 0 0; font-family: Arial, sans-serif; font-size: 13px; color: #7A6A6E; text-align: center;">Reason: ${esc(data.reason)}</p>` : ""}
        ${moneyTable(data.lines)}
        ${receiptAttachedNotice(data.receipt, color)}
        ${data.viewUrl ? button("View Transaction", data.viewUrl, color) : ""}`,
    }),
  };
};

/**
 * Sent when the provider could not complete a refund the studio already
 * promised. Deliberately not styled as a success — the customer's money has
 * NOT moved, and saying otherwise would be worse than saying nothing.
 */
export const refundFailed = (
  brand: EmailBrand,
  data: {
    customerFirstName?: string;
    subject: string;
    refundAmount: string;
    reference: string;
    failureReason?: string | null;
    supportEmail?: string | null;
  },
) => {
  const color = brandColor(brand);
  return {
    subject: "There was a problem with your refund",
    html: renderShell({
      brand,
      previewText: "We couldn't complete your refund.",
      documentType: "Refund failed",
      bodyHtml: `
        ${statusBadge("error", "REFUND FAILED")}
        <h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F; text-align: center;">Your refund didn't go through</h1>
        <p style="margin: 0 0 16px; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; line-height: 1.6; text-align: center;">
          ${data.customerFirstName ? `${esc(data.customerFirstName)}, we` : "We"} tried to refund
          <strong>${esc(data.refundAmount)}</strong> for ${esc(data.subject)}, but it couldn't be
          completed. No money has been returned yet — we're looking into it and will be in touch.
        </p>
        ${data.failureReason ? `<p class="muted" style="margin: 0 0 16px; font-family: Arial, sans-serif; font-size: 13px; color: #7A6A6E; text-align: center;">Reason given: ${esc(data.failureReason)}</p>` : ""}
        <p class="muted" style="margin: 0; font-family: Arial, sans-serif; font-size: 12px; color: #7A6A6E; text-align: center;">Reference: ${esc(data.reference)}</p>
        ${data.supportEmail ? button("Contact Support", `mailto:${data.supportEmail}`, color) : ""}`,
    }),
  };
};
