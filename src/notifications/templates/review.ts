import { renderShell, button, esc, brandColor } from "../design/shell";
import { EmailBrand } from "../types";

/**
 * Sent to the CUSTOMER a day after a completed visit, or a few days after an
 * order was handed over: a short ask for a review, with one button.
 */
export const reviewRequest = (
  brand: EmailBrand,
  data: { customerFirstName: string; studioName: string; what: string; reviewUrl: string },
) => ({
  subject: `How was ${data.what}?`,
  html: renderShell({
    brand,
    previewText: `Tell ${data.studioName} how it went. It takes a minute.`,
    bodyHtml: `
      <h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F; text-align: center;">How did we do?</h1>
      <p style="margin: 0; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; line-height: 1.6; text-align: center;">
        Hi ${esc(data.customerFirstName)}, thank you for choosing ${esc(data.studioName)}. We'd love to hear what you thought of ${esc(data.what)}.
        Your review helps others decide, and helps us get better.
      </p>
      ${button("Leave a review", data.reviewUrl, brandColor(brand))}`,
  }),
});
