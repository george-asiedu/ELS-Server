import {
  renderShell,
  button,
  esc,
  statusBadge,
  brandColor,
} from "../design/shell";
import { EmailBrand } from "../types";

/** Sent to the Zuri team when a studio asks for in-person training. */
export const trainingRequestSubmitted = (
  brand: EmailBrand,
  data: {
    studioName: string;
    studioSlug: string;
    requestedByEmail?: string | null;
    preferredDate?: string | null;
    location?: string | null;
    notes?: string | null;
    reviewUrl: string;
  },
) => {
  const color = brandColor(brand);
  const row = (label: string, value?: string | null) =>
    value
      ? `<tr><td style="padding: 8px 22px; font-family: Arial, sans-serif; font-size: 13px; color: #7A6A6E; width: 130px;">${esc(label)}</td><td style="padding: 8px 22px; font-family: Arial, sans-serif; font-size: 14px; color: #2A1B1F; white-space: pre-line;">${esc(value)}</td></tr>`
      : "";
  return {
    subject: `In-person training request from ${data.studioName}`,
    html: renderShell({
      brand,
      previewText: `${data.studioName} asked for in-person training`,
      documentType: "Training request",
      bodyHtml: `
        ${statusBadge("info", "NEW TRAINING REQUEST")}
        <h1 style="margin: 0 0 4px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F; text-align: center;">In-person training</h1>
        <p style="margin: 0 0 20px; font-family: Arial, sans-serif; font-size: 13px; color: #7A6A6E; text-align: center;">
          from <strong>${esc(data.studioName)}</strong> (${esc(data.studioSlug)})${
            data.requestedByEmail
              ? ` &middot; ${esc(data.requestedByEmail)}`
              : ""
          }
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 8px; border: 1px solid #EADFE1; border-radius: 12px;">
          ${row("Preferred date", data.preferredDate)}
          ${row("Where", data.location)}
          ${row("Notes", data.notes)}
        </table>
        <p style="margin: 12px 0 0; font-family: Arial, sans-serif; font-size: 13px; color: #7A6A6E; text-align: center;">Set the fee and the date, and the studio is told at each step.</p>
        ${button("Review Request", data.reviewUrl, color)}`,
    }),
  };
};
