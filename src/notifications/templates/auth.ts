import { renderShell, button, esc } from "../design/shell";
import { EmailBrand } from "../types";

const ROSE = "#BE185D";

export const passwordResetRequested = (
  brand: EmailBrand,
  data: { resetUrl: string; expiresInMinutes: number },
) => {
  const name = brand.kind === "studio" ? brand.studio.name : brand.zuri.name;
  return {
    subject: `Reset your ${name} password`,
    html: renderShell({
      brand,
      previewText: "Reset your password — this link expires soon.",
      bodyHtml: `
        <h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F;">Reset your password</h1>
        <p style="margin: 0 0 8px; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; line-height: 1.6;">
          We received a request to reset the password on your ${esc(name)} account.
          Click below to choose a new one — this link is valid for ${data.expiresInMinutes} minutes.
        </p>
        ${button("Reset Password", data.resetUrl, ROSE)}
        <p style="margin: 24px 0 0; font-family: Arial, sans-serif; font-size: 13px; color: #7A6A6E; line-height: 1.6;">
          If you didn't request this, you can safely ignore this email — your password won't change.
        </p>`,
    }),
  };
};

export const passwordChanged = (
  brand: EmailBrand,
  data: { email: string; changedAt: string },
) => {
  const name = brand.kind === "studio" ? brand.studio.name : brand.zuri.name;
  return {
    subject: `Your ${name} password was changed`,
    html: renderShell({
      brand,
      previewText: "Your password was just changed.",
      bodyHtml: `
        <h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F;">Password changed</h1>
        <p style="margin: 0 0 8px; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; line-height: 1.6;">
          The password for <strong>${esc(data.email)}</strong> was changed on ${esc(data.changedAt)}.
        </p>
        <p style="margin: 16px 0 0; font-family: Arial, sans-serif; font-size: 13px; color: #7A6A6E; line-height: 1.6;">
          If this wasn't you, please reset your password immediately and contact support.
        </p>`,
    }),
  };
};

export const customerWelcome = (
  brand: EmailBrand,
  data: { firstName: string; studioName?: string; studioUrl?: string },
) => {
  const greeting = data.studioName
    ? `Welcome to ${esc(data.studioName)}`
    : "Welcome to Zuri Studios";
  const color = brand.kind === "studio" ? "#BE185D" : ROSE;
  return {
    subject: data.studioName
      ? `Welcome to ${data.studioName}, ${data.firstName}`
      : `Welcome to Zuri Studios, ${data.firstName}`,
    html: renderShell({
      brand,
      previewText: "Your account is ready.",
      bodyHtml: `
        <h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F;">${greeting}, ${esc(data.firstName)} 👋</h1>
        <p style="margin: 0; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; line-height: 1.6;">
          Your account is ready. Book appointments, track your visits, and earn loyalty
          points every time you come in.
        </p>
        ${data.studioUrl ? button("Explore " + (data.studioName ?? "Studio"), data.studioUrl, color) : ""}`,
    }),
  };
};
