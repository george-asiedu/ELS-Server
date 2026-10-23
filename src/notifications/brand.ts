import { env } from "../config/env.config";
import { EmailBrand, StudioBrandingInfo } from "./types";

// The platform's own identity for account, billing and security mail — the
// sender address doubles as the support address, and links go to the client
// app this deployment serves.
export const platformBrand: EmailBrand = {
  kind: "zuri",
  zuri: {
    name: "Zuri Studios",
    websiteUrl: env.clientUrl,
    supportEmail: env.senderEmail,
  },
};

// Used for customer-facing storefront mail (bookings, payments, orders) on the
// rare path where the studio's own branding can't be resolved. Points at the
// public marketing site and the customer-support inbox rather than the app.
export const storefrontFallbackBrand: EmailBrand = {
  kind: "zuri",
  zuri: {
    name: "Zuri Studios",
    websiteUrl: "https://zuristudios.com",
    supportEmail: "customersupport@zuristudios.com",
  },
};

export const brandFromStudio = (
  studio: StudioBrandingInfo | null,
  fallback: EmailBrand,
): EmailBrand => (studio ? { kind: "studio", studio } : fallback);

// "Ama Mensah" → "Ama"; falls back to the full string when there's no space.
export const firstName = (fullName: string): string =>
  fullName.split(" ")[0] || fullName;
