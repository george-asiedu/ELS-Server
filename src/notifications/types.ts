// Shared data shapes for the notification system. Kept structural (not tied to
// Prisma's generated types) so template functions stay simple to test and
// don't need a real DB row to render — see registry.ts for how they're used.

export type PaymentStatus =
  | "UNPAID"
  | "PARTIALLY_PAID"
  | "PAID"
  | "FAILED"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED";

// Amounts arrive pre-formatted ("GHS 250.00") — Plunk/Liquid-style formatting
// in the template layer isn't available on our provider (flat variable
// substitution only, no expression language), so the backend is the only
// place that can safely do currency math and rounding. See notifications/README.md.
export interface MoneyLine {
  label: string;
  value: string; // pre-formatted, e.g. "GHS 180.00"
  emphasis?: boolean;
  muted?: boolean;
}

// A studio's brand identity, as it should appear on studio-facing emails
// (bookings, payments, orders). One template renders correctly for every
// tenant — see design/shell.ts.
export interface StudioBrandingInfo {
  name: string;
  logoUrl?: string | null;
  primaryColor?: string | null; // hex, e.g. "#BE185D"
  websiteUrl?: string | null;
  bookingUrl?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
}

// The platform's own identity, used for account/billing/security mail that
// isn't tied to a single studio's storefront.
export interface ZuriBrandingInfo {
  name: "Zuri Studios";
  websiteUrl: string;
  supportEmail: string;
}

export type EmailBrand =
  | { kind: "studio"; studio: StudioBrandingInfo }
  | { kind: "zuri"; zuri: ZuriBrandingInfo };
