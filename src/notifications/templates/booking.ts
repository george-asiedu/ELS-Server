import {
  renderShell,
  button,
  esc,
  appointmentCard,
  brandColor,
  statusBadge,
} from "../design/shell";
import { EmailBrand } from "../types";

interface BookingCore {
  serviceName: string;
  date: string;
  time: string;
  duration?: string | null;
  studioName: string;
  bookingRef: string; // short, human-friendly — derived from the real id, not invented
}

export const bookingRequestCustomer = (
  brand: EmailBrand,
  data: BookingCore & { customerFirstName: string; paymentRequired: boolean; bookingUrl?: string },
) => {
  const color = brandColor(brand);
  return {
    subject: "We've received your booking request",
    html: renderShell({
      brand,
      previewText: `Your ${data.serviceName} request is pending confirmation.`,
      bodyHtml: `
        ${statusBadge("pending", "PENDING CONFIRMATION")}
        <h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F; text-align: center;">Thanks, ${esc(data.customerFirstName)}!</h1>
        <p style="margin: 0 0 4px; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; line-height: 1.6; text-align: center;">
          We've received your appointment request and will confirm it shortly.
        </p>
        ${appointmentCard({ ...data, color })}
        <p style="margin: 0; font-family: Arial, sans-serif; font-size: 13px; color: #7A6A6E; text-align: center;">
          Reference: ${esc(data.bookingRef)}${data.paymentRequired ? " · Payment pending" : ""}
        </p>
        ${data.bookingUrl ? button("View Booking", data.bookingUrl, color) : ""}`,
    }),
  };
};

export const bookingRequestStudio = (
  brand: EmailBrand,
  data: BookingCore & {
    customerName: string;
    customerPhone: string;
    customerEmail?: string | null;
    notes?: string | null;
    designImageUrl?: string | null;
    dashboardUrl?: string;
  },
) => {
  const color = brandColor(brand);
  return {
    subject: `New appointment request from ${data.customerName}`,
    html: renderShell({
      brand,
      previewText: `${data.customerName} requested ${data.serviceName}.`,
      bodyHtml: `
        <h1 style="margin: 0 0 16px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F;">New booking request</h1>
        ${appointmentCard({ ...data, color })}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 4px 0 0; font-family: Arial, sans-serif; font-size: 14px; color: #2A1B1F;">
          <tr><td style="padding: 4px 0; color: #7A6A6E; width: 90px;">Customer</td><td style="padding: 4px 0;">${esc(data.customerName)}</td></tr>
          <tr><td style="padding: 4px 0; color: #7A6A6E;">Phone</td><td style="padding: 4px 0;">${esc(data.customerPhone)}</td></tr>
          ${data.customerEmail ? `<tr><td style="padding: 4px 0; color: #7A6A6E;">Email</td><td style="padding: 4px 0;">${esc(data.customerEmail)}</td></tr>` : ""}
          ${data.notes ? `<tr><td style="padding: 4px 0; color: #7A6A6E; vertical-align: top;">Notes</td><td style="padding: 4px 0;">${esc(data.notes)}</td></tr>` : ""}
        </table>
        ${data.designImageUrl ? `<p style="margin: 16px 0 0;"><img src="${esc(data.designImageUrl)}" alt="Design reference from ${esc(data.customerName)}" style="max-width: 100%; border-radius: 10px; border: 1px solid #EDE3E5;" /></p>` : ""}
        ${data.dashboardUrl ? button("Review Booking", data.dashboardUrl, color) : ""}`,
    }),
  };
};

export const bookingCompleted = (
  brand: EmailBrand,
  data: BookingCore & { customerFirstName: string; loyaltyPointsEarned?: number; reviewUrl?: string },
) => {
  const color = brandColor(brand);
  return {
    subject: `Thanks for visiting ${data.studioName} 💛`,
    html: renderShell({
      brand,
      previewText: "We hope you love your new look.",
      bodyHtml: `
        <h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F; text-align: center;">Thanks for visiting, ${esc(data.customerFirstName)}!</h1>
        <p style="margin: 0 0 4px; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; line-height: 1.6; text-align: center;">
          We hope you love your ${esc(data.serviceName.toLowerCase())}.
        </p>
        ${appointmentCard({ ...data, color })}
        ${
          data.loyaltyPointsEarned && data.loyaltyPointsEarned > 0
            ? `<p style="margin: 16px 0 0; font-family: Arial, sans-serif; font-size: 15px; color: ${color}; font-weight: 700; text-align: center;">You earned +${data.loyaltyPointsEarned} loyalty points</p>`
            : ""
        }
        ${data.reviewUrl ? button("Leave a Review", data.reviewUrl, color) : ""}`,
    }),
  };
};

export const bookingCancelled = (
  brand: EmailBrand,
  data: BookingCore & { customerFirstName: string; reason?: string | null; bookingUrl?: string },
) => ({
  subject: "Your appointment has been cancelled",
  html: renderShell({
    brand,
    previewText: `Your ${data.serviceName} appointment was cancelled.`,
    bodyHtml: `
      ${statusBadge("error", "CANCELLED")}
      <h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F; text-align: center;">Appointment cancelled</h1>
      <p style="margin: 0 0 4px; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; line-height: 1.6; text-align: center;">
        Hi ${esc(data.customerFirstName)}, your appointment has been cancelled.
      </p>
      ${appointmentCard({ ...data, color: "#B23B3B" })}
      ${data.reason ? `<p style="margin: 0; font-family: Arial, sans-serif; font-size: 13px; color: #7A6A6E; text-align: center;">Reason: ${esc(data.reason)}</p>` : ""}
      ${data.bookingUrl ? button("Book Again", data.bookingUrl, brandColor(brand)) : ""}`,
  }),
});
