import { renderShell, button, esc } from "../design/shell";
import { EmailBrand } from "../types";

const ROSE = "#FBC500";

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
        <p class="muted" style="margin: 24px 0 0; font-family: Arial, sans-serif; font-size: 13px; color: #7A6A6E; line-height: 1.6;">
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
        <p class="muted" style="margin: 16px 0 0; font-family: Arial, sans-serif; font-size: 13px; color: #7A6A6E; line-height: 1.6;">
          If this wasn't you, please reset your password immediately and contact support.
        </p>`,
    }),
  };
};

export const accountLocked = (
  brand: EmailBrand,
  data: { lockedFor: string; recoveryUrl: string },
) => ({
  subject: "Sign-in to your account has been paused",
  html: renderShell({
    brand,
    previewText: `Too many wrong passwords. Sign-in is locked for ${data.lockedFor}.`,
    bodyHtml: `
        <h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F;">Sign-in paused</h1>
        <p style="margin: 0 0 16px; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; line-height: 1.6;">
          Someone entered the wrong password for your account 3 times, so we've locked sign-in for ${esc(data.lockedFor)}. You can try again after that.
        </p>
        ${button("Reset your password", data.recoveryUrl, ROSE)}
        <p class="muted" style="margin: 20px 0 0; font-family: Arial, sans-serif; font-size: 13px; color: #7A6A6E; line-height: 1.6;">
          Resetting your password opens sign-in straight away. If this wasn't you, we recommend doing that now.
        </p>`,
  }),
});

export const emailVerificationCode = (
  brand: EmailBrand,
  data: { code: string; expiresInMinutes: number },
) => ({
  subject: `${data.code} is your Zuri Studios verification code`,
  html: renderShell({
    brand,
    previewText: `Your code is ${data.code}.`,
    bodyHtml: `
        <h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F;">Confirm your email</h1>
        <p style="margin: 0 0 16px; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; line-height: 1.6;">
          Enter this code to continue setting up your account. It expires in ${data.expiresInMinutes} minutes.
        </p>
        <p style="margin: 0 0 16px; font-family: Arial, sans-serif; font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #2A1B1F;">${esc(data.code)}</p>
        <p class="muted" style="margin: 0; font-family: Arial, sans-serif; font-size: 13px; color: #7A6A6E; line-height: 1.6;">
          If you didn't ask for this, you can ignore this email.
        </p>`,
  }),
});

export const loginAlert = (
  brand: EmailBrand,
  data: {
    device: string;
    ipAddress: string;
    signedInAt: string;
    recoveryUrl: string;
  },
) => {
  const brandName =
    brand.kind === "studio" ? brand.studio.name : brand.zuri.name;
  const safeBrandName = brandName.replace(/[\r\n]+/g, " ").slice(0, 100);
  return {
    subject: `New sign-in to your ${safeBrandName} account`,
    html: renderShell({
      brand,
      previewText: "A new device signed in to your account.",
      bodyHtml: `
        <h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F;">New sign-in</h1>
        <p style="margin: 0 0 16px; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; line-height: 1.6;">
          A new device signed in to your ${esc(brandName)} account. We send this alert once for each new browser or device.
        </p>
        <table role="presentation" style="width: 100%; border-collapse: collapse; font-family: Arial, sans-serif; font-size: 13px; color: #2A1B1F;">
          <tr><td class="muted" style="padding: 8px 0; color: #7A6A6E;">Device / browser</td><td style="padding: 8px 0;">${esc(data.device)}</td></tr>
          <tr><td class="muted" style="padding: 8px 0; color: #7A6A6E;">IP address</td><td style="padding: 8px 0;">${esc(data.ipAddress)}</td></tr>
          <tr><td class="muted" style="padding: 8px 0; color: #7A6A6E;">Time (UTC)</td><td style="padding: 8px 0;">${esc(data.signedInAt)}</td></tr>
        </table>
        ${button("Reset your password", data.recoveryUrl, ROSE)}
        <p class="muted" style="margin: 20px 0 0; font-family: Arial, sans-serif; font-size: 13px; color: #7A6A6E; line-height: 1.6;">
          If this wasn't you, reset your password immediately. Signing out of other devices will also revoke their sessions.
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
  const color = brand.kind === "studio" ? "#FBC500" : ROSE;
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
