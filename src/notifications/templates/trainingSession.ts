import {
  renderShell,
  button,
  esc,
  statusBadge,
  brandColor,
} from "../design/shell";
import { EmailBrand } from "../types";

/** To the studio: its spot at the free live online training is reserved (or moved). */
export const trainingSpotConfirmed = (
  brand: EmailBrand,
  data: {
    firstName: string;
    when: string;
    note?: string | null;
    joinUrl?: string | null;
    calendarUrl: string;
    moved?: boolean;
  },
) => {
  const color = brandColor(brand);
  return {
    subject: data.moved
      ? "Your live training has moved"
      : "Your spot at the live training is reserved",
    html: renderShell({
      brand,
      previewText: `Live training: ${data.when}`,
      documentType: "Live training",
      bodyHtml: `
        ${statusBadge(data.moved ? "warning" : "success", data.moved ? "NEW TIME" : "SPOT RESERVED")}
        <h1 style="margin: 0 0 8px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F; text-align: center;">${data.moved ? "The session has a new time" : "You're in, " + esc(data.firstName)}</h1>
        <p style="margin: 0 0 18px; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; text-align: center; line-height: 1.6;">
          Free live online training with Zuri<br /><strong>${esc(data.when)}</strong>
        </p>
        ${data.note ? `<p style="margin: 0 0 18px; font-family: Arial, sans-serif; font-size: 14px; color: #7A6A6E; text-align: center;">${esc(data.note)}</p>` : ""}
        ${data.joinUrl ? button("Join the session", data.joinUrl, color) : ""}
        <p style="margin: 0; font-family: Arial, sans-serif; font-size: 13px; color: #7A6A6E; text-align: center; line-height: 1.6;">
          A calendar file is attached, so you can add it to your calendar and get a reminder 15 minutes before.
          Or <a href="${esc(data.calendarUrl)}" style="color: ${color};">add it to Google Calendar</a>.
          You can cancel your spot from the Learn page in your dashboard.
        </p>`,
    }),
  };
};

/** To the Zuri team: a studio reserved a spot. */
export const trainingSpotReservedPlatform = (
  brand: EmailBrand,
  data: {
    studioName: string;
    studioSlug: string;
    byEmail?: string | null;
    when: string;
    total: number;
    reviewUrl: string;
  },
) => {
  const color = brandColor(brand);
  return {
    subject: `${data.studioName} reserved a spot at the live training`,
    html: renderShell({
      brand,
      previewText: `${data.studioName} reserved a spot`,
      documentType: "Live training",
      bodyHtml: `
        ${statusBadge("info", "SPOT RESERVED")}
        <h1 style="margin: 0 0 4px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F; text-align: center;">${esc(data.studioName)}</h1>
        <p style="margin: 0 0 20px; font-family: Arial, sans-serif; font-size: 13px; color: #7A6A6E; text-align: center;">
          (${esc(data.studioSlug)})${data.byEmail ? ` &middot; ${esc(data.byEmail)}` : ""} will join<br />
          <strong>${esc(data.when)}</strong>
        </p>
        <p style="margin: 0; font-family: Arial, sans-serif; font-size: 14px; color: #2A1B1F; text-align: center;">${data.total} ${data.total === 1 ? "studio has" : "studios have"} reserved a spot so far.</p>
        ${button("See who is coming", data.reviewUrl, color)}`,
    }),
  };
};
