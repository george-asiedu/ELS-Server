import { renderShell, button, esc, statusBadge } from "../design/shell";
import { EmailBrand } from "../types";

// Studio lifecycle mail is always Zuri-branded (the studio doesn't have its
// own branding yet at signup, and suspension is a platform action) — callers
// always pass a { kind: "zuri" } brand here.

export const studioCreated = (
  brand: EmailBrand,
  data: {
    ownerFirstName: string;
    studioName: string;
    planName: string;
    dashboardUrl: string;
    storefrontUrl: string;
    /** The free training page in their dashboard. */
    learnUrl?: string;
  },
) => ({
  subject: "Your studio is now live on Zuri",
  html: renderShell({
    brand,
    previewText: `${data.studioName} is live.`,
    documentType: "Studio activated",
    bodyHtml: `
      ${statusBadge("success", "STUDIO LIVE")}
      <h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F; text-align: center;">Welcome, ${esc(data.ownerFirstName)}</h1>
      <p style="margin: 0 0 4px; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; line-height: 1.6; text-align: center;">
        <strong>${esc(data.studioName)}</strong> is live on Zuri, on the ${esc(data.planName)} plan.
      </p>
      <p class="muted" style="margin: 0; font-family: Arial, sans-serif; font-size: 13px; color: #7A6A6E; text-align: center;">
        Your storefront: <a class="accent" href="${esc(data.storefrontUrl)}" style="color: #947400;">${esc(data.storefrontUrl.replace(/^https?:\/\//, ""))}</a>
      </p>
      ${button("Open Studio Dashboard", data.dashboardUrl, "#FBC500")}
      ${
        data.learnUrl
          ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0 0; border: 1px solid #EADFE1; border-radius: 12px;">
        <tr><td style="padding: 16px 20px; font-family: Arial, sans-serif; font-size: 14px; color: #2A1B1F; line-height: 1.6;">
          <strong>Free training, so you can get going on your own</strong><br>
          Short guides for each part of Zuri and a free live online session are waiting in your dashboard.
          Prefer someone beside you? In-person training is available for a fee. Ask for it from the same page.
          <br><a class="accent" href="${esc(data.learnUrl)}" style="color: #947400;">Start learning</a>
        </td></tr></table>`
          : ""
      }`,
  }),
});

export const studioAccountSuspended = (
  brand: EmailBrand,
  data: { studioName: string; supportEmail: string },
) => ({
  subject: "Action required for your studio account",
  html: renderShell({
    brand,
    previewText: "Your studio account has been suspended.",
    bodyHtml: `
      ${statusBadge("warning", "ACCOUNT SUSPENDED")}
      <h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F; text-align: center;">Your studio account is suspended</h1>
      <p style="margin: 0; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; line-height: 1.6; text-align: center;">
        <strong>${esc(data.studioName)}</strong> has been suspended and its storefront is currently unavailable to
        customers. If you believe this is a mistake, or would like to resolve it, please contact us at
        <a class="accent" href="mailto:${esc(data.supportEmail)}" style="color: #947400;">${esc(data.supportEmail)}</a>.
      </p>`,
  }),
});
