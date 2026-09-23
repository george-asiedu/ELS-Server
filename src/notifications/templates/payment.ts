import { renderShell, button, esc, statusBadge, moneyTable, brandColor } from "../design/shell";
import { EmailBrand, MoneyLine } from "../types";

export const paymentSuccess = (
  brand: EmailBrand,
  data: {
    customerFirstName: string;
    serviceName: string;
    reference: string;
    isPartial: boolean;
    lines: MoneyLine[]; // pre-built: Total / Amount paid / Remaining (if any)
    viewUrl?: string;
  },
) => {
  const color = brandColor(brand);
  return {
    subject: `Payment received — ${data.serviceName}`,
    html: renderShell({
      brand,
      previewText: "Your payment has been received.",
      bodyHtml: `
        ${statusBadge("success", data.isPartial ? "DEPOSIT RECEIVED" : "PAYMENT SUCCESSFUL")}
        <h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F; text-align: center;">Thank you, ${esc(data.customerFirstName)}</h1>
        <p style="margin: 0; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; line-height: 1.6; text-align: center;">
          Your payment for <strong>${esc(data.serviceName)}</strong> was successful.
        </p>
        ${moneyTable(data.lines)}
        <p style="margin: 0; font-family: Arial, sans-serif; font-size: 12px; color: #7A6A6E; text-align: center;">Reference: ${esc(data.reference)}</p>
        ${data.viewUrl ? button("View Booking", data.viewUrl, color) : ""}`,
    }),
  };
};

export const paymentFailed = (
  brand: EmailBrand,
  data: {
    customerFirstName?: string;
    serviceName: string;
    amountAttempted: string;
    reference: string;
    retryUrl?: string;
  },
) => {
  const color = brandColor(brand);
  return {
    subject: "We couldn't process your payment",
    html: renderShell({
      brand,
      previewText: "Your payment didn't go through.",
      bodyHtml: `
        ${statusBadge("error", "PAYMENT FAILED")}
        <h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F; text-align: center;">Payment not completed</h1>
        <p style="margin: 0 0 16px; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; line-height: 1.6; text-align: center;">
          ${data.customerFirstName ? `Hi ${esc(data.customerFirstName)}, w` : "W"}e couldn't process your payment of
          <strong>${esc(data.amountAttempted)}</strong> for ${esc(data.serviceName)}. No charge was made.
        </p>
        <p style="margin: 0; font-family: Arial, sans-serif; font-size: 12px; color: #7A6A6E; text-align: center;">Reference: ${esc(data.reference)}</p>
        ${data.retryUrl ? button("Try Payment Again", data.retryUrl, color) : ""}`,
    }),
  };
};
