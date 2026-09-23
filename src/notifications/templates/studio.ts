import { renderShell, button, esc, statusBadge } from "../design/shell";
import { EmailBrand } from "../types";

// Studio lifecycle mail is always Zuri-branded (the studio doesn't have its
// own branding yet at signup, and suspension is a platform action) — callers
// always pass a { kind: "zuri" } brand here.

export const studioCreated = (
  brand: EmailBrand,
  data: { ownerFirstName: string; studioName: string; planName: string; dashboardUrl: string; storefrontUrl: string },
) => ({
  subject: "Your studio is now on Zuri Studios 🎉",
  html: renderShell({
    brand,
    previewText: `${data.studioName} is live.`,
    bodyHtml: `
      ${statusBadge("success", "STUDIO LIVE")}
      <h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F; text-align: center;">Welcome, ${esc(data.ownerFirstName)}!</h1>
      <p style="margin: 0 0 4px; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; line-height: 1.6; text-align: center;">
        <strong>${esc(data.studioName)}</strong> is live on Zuri Studios, on the ${esc(data.planName)} plan.
      </p>
      <p style="margin: 0; font-family: Arial, sans-serif; font-size: 13px; color: #7A6A6E; text-align: center;">
        Your storefront: <a href="${esc(data.storefrontUrl)}" style="color: #BE185D;">${esc(data.storefrontUrl.replace(/^https?:\/\//, ""))}</a>
      </p>
      ${button("Open Studio Dashboard", data.dashboardUrl, "#BE185D")}`,
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
        <a href="mailto:${esc(data.supportEmail)}" style="color: #BE185D;">${esc(data.supportEmail)}</a>.
      </p>`,
  }),
});
