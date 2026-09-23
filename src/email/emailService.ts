import { env } from "../config/env.config";
import { emailQueue } from "../queue/queues";

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  // Kept for call-site compatibility; Plunk's API takes a single HTML body.
  text?: string;
}

// The actual Plunk API call — used directly by callers with no queue configured,
// and by the email worker when a queue IS configured. Exported so the worker
// (a separate module, to keep BullMQ out of request-handling code paths) can
// call the exact same send logic.
export const sendEmailNow = async ({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> => {
  const res = await fetch(env.plunk.apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.plunk.secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to,
      subject,
      body: html,
      from: env.senderEmail,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Plunk email send failed (${res.status}): ${detail}`);
  }
};

export class EmailService {
  // Enqueues the email when a queue is configured (REDIS_URL set) — a worker
  // sends it in the background with automatic retries, so a slow/flaky Plunk
  // call never blocks the request that triggered it (booking, checkout,
  // password reset, ...). Falls back to sending inline when there's no queue,
  // so the app keeps working exactly as before without Redis provisioned.
  private async send({ to, subject, html }: SendArgs) {
    if (emailQueue) {
      await emailQueue.add("send", { to, subject, html });
      return;
    }
    await sendEmailNow({ to, subject, html });
  }

  public async sendPasswordReset(
    to: string,
    resetUrl: string,
    brand = "Zuri Studios",
  ) {
    const subject = `Reset your ${brand} password`;
    const text = `You requested a password reset.\n\nReset your password using this link (valid for 1 hour):\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1f2937;">
        <h2 style="color: #be185d;">${brand}</h2>
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
    brand = "Zuri Studios",
  ) {
    const { fullName, serviceName, date, time } = details;
    const subject = "We've received your appointment request";
    const text =
      `Hi ${fullName},\n\n` +
      `Thank you for booking with ${brand}! We've received your request:\n\n` +
      `Service: ${serviceName}\n` +
      `Date: ${date}\n` +
      `Time: ${time}\n` +
      `Status: Pending confirmation\n\n` +
      `We'll confirm your appointment shortly. See you soon!\n\n` +
      `— ${brand}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1f2937;">
        <h2 style="color: #be185d;">${brand}</h2>
        <p>Hi ${fullName},</p>
        <p>Thank you for booking with us! We've received your appointment request:</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 6px 0; color: #6b7280;">Service</td><td style="padding: 6px 0; font-weight: 600;">${serviceName}</td></tr>
          <tr><td style="padding: 6px 0; color: #6b7280;">Date</td><td style="padding: 6px 0; font-weight: 600;">${date}</td></tr>
          <tr><td style="padding: 6px 0; color: #6b7280;">Time</td><td style="padding: 6px 0; font-weight: 600;">${time}</td></tr>
          <tr><td style="padding: 6px 0; color: #6b7280;">Status</td><td style="padding: 6px 0; font-weight: 600; color: #d97706;">Pending confirmation</td></tr>
        </table>
        <p>We'll confirm your appointment shortly. See you soon! 💅</p>
        <p style="font-size: 12px; color: #6b7280;">— ${brand}</p>
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
    brand = "Zuri Studios",
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
    const subject = `Your ${brand} payment receipt`;
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
      `See you soon!\n\n— ${brand}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1f2937;">
        <h2 style="color: #be185d;">${brand}</h2>
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
        <p style="font-size: 12px; color: #6b7280;">— ${brand}</p>
      </div>
    `;
    await this.send({ to, subject, html, text });
  }

  public async sendOrderReceipt(
    to: string,
    details: {
      orderNumber: string;
      items: { name: string; quantity: number; unitPrice: number }[];
      subtotal: number;
      deliveryFee: number;
      total: number;
      fulfillment: string;
      reference: string;
    },
    brand = "Zuri Studios",
  ) {
    const { orderNumber, items, subtotal, deliveryFee, total, fulfillment, reference } =
      details;
    const subject = `Your ${brand} order ${orderNumber}`;
    const itemsText = items
      .map((i) => `- ${i.name} x${i.quantity} — GHS ${i.unitPrice * i.quantity}`)
      .join("\n");
    const text =
      `Thank you for your order!\n\n` +
      `Order: ${orderNumber}\n` +
      `Fulfillment: ${fulfillment === "DELIVERY" ? "Delivery" : "Pickup at studio"}\n\n` +
      `${itemsText}\n\n` +
      `Subtotal: GHS ${subtotal}\n` +
      (deliveryFee > 0 ? `Delivery: GHS ${deliveryFee}\n` : "") +
      `Total: GHS ${total}\n` +
      `Reference: ${reference}\n\n` +
      `— ${brand}`;
    const itemsHtml = items
      .map(
        (i) =>
          `<tr><td style="padding:6px 0;">${i.name} <span style="color:#6b7280;">x${i.quantity}</span></td><td style="padding:6px 0; text-align:right; font-weight:600;">GHS ${i.unitPrice * i.quantity}</td></tr>`,
      )
      .join("");
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1f2937;">
        <h2 style="color: #be185d;">${brand}</h2>
        <p>Thank you for your order!</p>
        <p style="color:#6b7280; margin:0;">Order</p>
        <p style="font-weight:600; margin-top:2px;">${orderNumber}</p>
        <p style="color:#6b7280; margin:12px 0 0;">Fulfillment</p>
        <p style="font-weight:600; margin-top:2px;">${fulfillment === "DELIVERY" ? "Delivery" : "Pickup at studio"}</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0; border-top:1px solid #e5e7eb;">
          ${itemsHtml}
        </table>
        <table style="width:100%; border-collapse:collapse; border-top:1px solid #e5e7eb;">
          <tr><td style="padding:6px 0; color:#6b7280;">Subtotal</td><td style="padding:6px 0; text-align:right;">GHS ${subtotal}</td></tr>
          ${deliveryFee > 0 ? `<tr><td style="padding:6px 0; color:#6b7280;">Delivery</td><td style="padding:6px 0; text-align:right;">GHS ${deliveryFee}</td></tr>` : ""}
          <tr><td style="padding:6px 0; font-weight:700; color:#be185d;">Total</td><td style="padding:6px 0; text-align:right; font-weight:700; color:#be185d;">GHS ${total}</td></tr>
        </table>
        <p style="font-size: 12px; color: #6b7280;">Reference: ${reference}</p>
        <p style="font-size: 12px; color: #6b7280;">— ${brand}</p>
      </div>
    `;
    await this.send({ to, subject, html, text });
  }
}
