import { renderShell, button, esc, statusBadge } from "../design/shell";
import { EmailBrand } from "../types";

// Billing lifecycle mail — always Zuri-branded, since it's the platform's
// relationship with the studio owner, not the studio's own storefront brand.
// Only covers SUBSCRIPTION billing mode: REVENUE_SHARE studios have no
// billing period to expire, so these never fire for them (see registry.ts).

export const subscriptionExpiringSoon = (
  brand: EmailBrand,
  data: { planName: string; renewsOn: string; amountDue: string; manageUrl: string },
) => ({
  subject: "Your Zuri Studios plan renews soon",
  html: renderShell({
    brand,
    previewText: `Your plan renews on ${data.renewsOn}.`,
    bodyHtml: `
      ${statusBadge("info", "RENEWS SOON")}
      <h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F; text-align: center;">Your plan renews soon</h1>
      <p style="margin: 0; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; line-height: 1.6; text-align: center;">
        Your <strong>${esc(data.planName)}</strong> plan is due for renewal on <strong>${esc(data.renewsOn)}</strong>
        (${esc(data.amountDue)}). Renew from your dashboard before then to avoid any interruption —
        plans don't renew automatically.
      </p>
      ${button("Manage Subscription", data.manageUrl, "#BE185D")}`,
  }),
});

export const subscriptionExpired = (
  brand: EmailBrand,
  data: { planName: string; expiredOn: string; reactivateUrl: string },
) => ({
  subject: "Your Zuri Studios plan has expired",
  html: renderShell({
    brand,
    previewText: "Your plan has expired — renew to restore your storefront.",
    bodyHtml: `
      ${statusBadge("warning", "PLAN EXPIRED")}
      <h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F; text-align: center;">Your plan has expired</h1>
      <p style="margin: 0; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; line-height: 1.6; text-align: center;">
        Your <strong>${esc(data.planName)}</strong> plan expired on <strong>${esc(data.expiredOn)}</strong> and your
        storefront may be unavailable to customers until you renew.
      </p>
      ${button("Reactivate Subscription", data.reactivateUrl, "#BE185D")}`,
  }),
});
