import sgMail from "@sendgrid/mail";
import { env } from "../config/env.config";

let configured = false;

const ensureConfigured = () => {
  if (!configured) {
    sgMail.setApiKey(env.sendGridApiKey);
    configured = true;
  }
};

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export class EmailService {
  private async send({ to, subject, html, text }: SendArgs) {
    ensureConfigured();
    await sgMail.send({
      to,
      from: env.senderEmail,
      subject,
      text,
      html,
    });
  }

  public async sendPasswordReset(to: string, resetUrl: string) {
    const subject = "Reset your EL Beauty Studio password";
    const text = `You requested a password reset.\n\nReset your password using this link (valid for 1 hour):\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1f2937;">
        <h2 style="color: #be185d;">EL Beauty Studio</h2>
        <p>You requested to reset your password.</p>
        <p>Click the button below to choose a new password. This link is valid for <strong>1 hour</strong>.</p>
        <p style="text-align: center; margin: 32px 0;">
          <a href="${resetUrl}"
             style="background: #be185d; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block;">
            Reset Password
          </a>
        </p>
        <p style="font-size: 12px; color: #6b7280;">
          If the button doesn't work, copy and paste this link into your browser:<br />
          <a href="${resetUrl}">${resetUrl}</a>
        </p>
        <p style="font-size: 12px; color: #6b7280;">
          If you didn't request this, you can safely ignore this email.
        </p>
      </div>
    `;
    await this.send({ to, subject, html, text });
  }
}
