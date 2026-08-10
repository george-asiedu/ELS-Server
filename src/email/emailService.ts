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

  public async sendAppointmentReceived(
    to: string,
    details: {
      fullName: string;
      serviceName: string;
      date: string;
      time: string;
    },
  ) {
    const { fullName, serviceName, date, time } = details;
    const subject = "We've received your appointment request";
    const text =
      `Hi ${fullName},\n\n` +
      `Thank you for booking with EL Beauty Studio! We've received your request:\n\n` +
      `Service: ${serviceName}\n` +
      `Date: ${date}\n` +
      `Time: ${time}\n` +
      `Status: Pending confirmation\n\n` +
      `We'll confirm your appointment shortly. See you soon!\n\n` +
      `— EL Beauty Studio`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1f2937;">
        <h2 style="color: #be185d;">EL Beauty Studio</h2>
        <p>Hi ${fullName},</p>
        <p>Thank you for booking with us! We've received your appointment request:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 6px 0; color: #6b7280;">Service</td><td style="padding: 6px 0; font-weight: 600;">${serviceName}</td></tr>
          <tr><td style="padding: 6px 0; color: #6b7280;">Date</td><td style="padding: 6px 0; font-weight: 600;">${date}</td></tr>
          <tr><td style="padding: 6px 0; color: #6b7280;">Time</td><td style="padding: 6px 0; font-weight: 600;">${time}</td></tr>
          <tr><td style="padding: 6px 0; color: #6b7280;">Status</td><td style="padding: 6px 0; font-weight: 600; color: #d97706;">Pending confirmation</td></tr>
        </table>
        <p>We'll confirm your appointment shortly. See you soon! 💅</p>
        <p style="font-size: 12px; color: #6b7280;">— EL Beauty Studio</p>
      </div>
    `;
    await this.send({ to, subject, html, text });
  }

  public async sendPaymentReceipt(
    to: string,
    details: {
      fullName: string;
      serviceName: string;
      reference: string;
      amountPaid: number;
      totalAmount: number;
      type: "FULL" | "PARTIAL";
      balance: number;
      date: string;
      time: string;
    },
  ) {
    const {
      fullName,
      serviceName,
      reference,
      amountPaid,
      totalAmount,
      type,
      balance,
      date,
      time,
    } = details;
    const label = type === "PARTIAL" ? "Deposit paid" : "Amount paid";
    const subject = "Your EL Beauty Studio payment receipt";
    const balanceLine =
      balance > 0
        ? `Balance due at studio: GHS ${balance}\n`
        : "";
    const text =
      `Hi ${fullName},\n\n` +
      `Thank you for your payment. Here is your receipt:\n\n` +
      `Service: ${serviceName}\n` +
      `Date: ${date}\n` +
      `Time: ${time}\n` +
      `${label}: GHS ${amountPaid}\n` +
      `Total: GHS ${totalAmount}\n` +
      balanceLine +
      `Reference: ${reference}\n\n` +
      `See you soon!\n\n— EL Beauty Studio`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1f2937;">
        <h2 style="color: #be185d;">EL Beauty Studio</h2>
        <p>Hi ${fullName},</p>
        <p>Thank you for your payment. Here is your receipt:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 6px 0; color: #6b7280;">Service</td><td style="padding: 6px 0; font-weight: 600;">${serviceName}</td></tr>
          <tr><td style="padding: 6px 0; color: #6b7280;">Date</td><td style="padding: 6px 0; font-weight: 600;">${date}</td></tr>
          <tr><td style="padding: 6px 0; color: #6b7280;">Time</td><td style="padding: 6px 0; font-weight: 600;">${time}</td></tr>
          <tr><td style="padding: 6px 0; color: #6b7280;">${label}</td><td style="padding: 6px 0; font-weight: 600; color: #16a34a;">GHS ${amountPaid}</td></tr>
          <tr><td style="padding: 6px 0; color: #6b7280;">Total</td><td style="padding: 6px 0; font-weight: 600;">GHS ${totalAmount}</td></tr>
          ${
            balance > 0
              ? `<tr><td style="padding: 6px 0; color: #6b7280;">Balance due at studio</td><td style="padding: 6px 0; font-weight: 600; color: #d97706;">GHS ${balance}</td></tr>`
              : ""
          }
          <tr><td style="padding: 6px 0; color: #6b7280;">Reference</td><td style="padding: 6px 0; font-weight: 600;">${reference}</td></tr>
        </table>
        <p>See you soon! 💅</p>
        <p style="font-size: 12px; color: #6b7280;">— EL Beauty Studio</p>
      </div>
    `;
    await this.send({ to, subject, html, text });
  }
}
