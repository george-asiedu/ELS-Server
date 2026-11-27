import {
  renderShell,
  button,
  esc,
  statusBadge,
  brandColor,
} from "../design/shell";
import { EmailBrand } from "../types";

/** To a new staff member: their account is ready, and how to set a password. */
export const staffAccountCreated = (
  brand: EmailBrand,
  data: {
    name: string;
    studioName: string;
    email: string;
    loginUrl: string;
  },
) => {
  const color = brandColor(brand);
  return {
    subject: `Your ${data.studioName} staff account is ready`,
    html: renderShell({
      brand,
      previewText: `${data.studioName} added you to the team.`,
      documentType: "Staff account",
      bodyHtml: `
        ${statusBadge("success", "ACCOUNT READY")}
        <h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F; text-align: center;">Welcome to the team, ${esc(data.name)}</h1>
        <p style="margin: 0 0 18px; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; text-align: center; line-height: 1.6;">
          ${esc(data.studioName)} added you. Sign in to see your own bookings and get alerts when one is about to start.
        </p>
        <p style="margin: 0 0 6px; font-family: Arial, sans-serif; font-size: 14px; color: #7A6A6E; text-align: center; line-height: 1.6;">
          The first time, choose <strong>First time here? Set your password</strong> and enter <strong>${esc(data.email)}</strong>. We'll send you a code to confirm it's you.
        </p>
        ${button("Open the staff sign-in", data.loginUrl, color)}`,
    }),
  };
};
