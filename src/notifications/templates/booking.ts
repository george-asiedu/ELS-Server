import {
  renderShell,
  button,
  esc,
  appointmentCard,
  brandColor,
  statusBadge,
  moneyTable,
} from "../design/shell";
import { EmailBrand, MoneyLine } from "../types";

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
      documentType: "Booking request",
      bodyHtml: `
        ${statusBadge("pending", "PENDING CONFIRMATION")}
        <h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F; text-align: center;">Thanks, ${esc(data.customerFirstName)}!</h1>
        <p style="margin: 0 0 4px; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; line-height: 1.6; text-align: center;">
          We've received your appointment request and will confirm it shortly.
        </p>
        ${appointmentCard({ ...data, color })}
        <p class="muted" style="margin: 0; font-family: Arial, sans-serif; font-size: 13px; color: #7A6A6E; text-align: center;">
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
      documentType: "Booking request",
      bodyHtml: `
        <h1 style="margin: 0 0 16px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F;">New booking request</h1>
        ${appointmentCard({ ...data, color })}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 4px 0 0; font-family: Arial, sans-serif; font-size: 14px; color: #2A1B1F;">
          <tr><td class="muted" style="padding: 4px 0; color: #7A6A6E; width: 90px;">Customer</td><td style="padding: 4px 0;">${esc(data.customerName)}</td></tr>
          <tr><td class="muted" style="padding: 4px 0; color: #7A6A6E;">Phone</td><td style="padding: 4px 0;">${esc(data.customerPhone)}</td></tr>
          ${data.customerEmail ? `<tr><td class="muted" style="padding: 4px 0; color: #7A6A6E;">Email</td><td style="padding: 4px 0;">${esc(data.customerEmail)}</td></tr>` : ""}
          ${data.notes ? `<tr><td class="muted" style="padding: 4px 0; color: #7A6A6E; vertical-align: top;">Notes</td><td style="padding: 4px 0;">${esc(data.notes)}</td></tr>` : ""}
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
      documentType: "Appointment completed",
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
      documentType: "Appointment cancelled",
    bodyHtml: `
      ${statusBadge("error", "CANCELLED")}
      <h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F; text-align: center;">Appointment cancelled</h1>
      <p style="margin: 0 0 4px; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; line-height: 1.6; text-align: center;">
        Hi ${esc(data.customerFirstName)}, your appointment has been cancelled.
      </p>
      ${appointmentCard({ ...data, color: "#B23B3B" })}
      ${data.reason ? `<p class="muted" style="margin: 0; font-family: Arial, sans-serif; font-size: 13px; color: #7A6A6E; text-align: center;">Reason: ${esc(data.reason)}</p>` : ""}
      ${data.bookingUrl ? button("Book Again", data.bookingUrl, brandColor(brand)) : ""}`,
  }),
});

/**
 * Sent when the studio approves a booking.
 *
 * Booking state and payment state are independent here, deliberately: a
 * confirmed appointment may be unpaid, part-paid or paid in full, and the
 * email must not imply otherwise. `paymentLines` is omitted entirely when
 * there is nothing to say about money.
 */
export const bookingConfirmed = (
  brand: EmailBrand,
  data: BookingCore & {
    customerFirstName: string;
    paymentStatusLabel: "UNPAID" | "PARTIALLY PAID" | "PAID IN FULL";
    paymentLines?: MoneyLine[];
    balanceDue?: string | null;
    bookingUrl?: string;
  },
) => {
  const color = brandColor(brand);
  return {
    subject: "Your appointment is confirmed ✨",
    html: renderShell({
      brand,
      previewText: `${data.serviceName} on ${data.date} at ${data.time}.`,
      documentType: "Appointment confirmed",
      bodyHtml: `
        ${statusBadge("success", "APPOINTMENT CONFIRMED")}
        <h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F; text-align: center;">You're all set, ${esc(data.customerFirstName)}</h1>
        <p class="muted" style="margin: 0; font-family: Arial, sans-serif; font-size: 14px; color: #7A6A6E; text-align: center;">
          ${esc(data.studioName)} has confirmed your appointment.
        </p>
        ${appointmentCard({ serviceName: data.serviceName, date: data.date, time: data.time, duration: data.duration ?? null, studioName: data.studioName, color })}
        <p class="muted" style="margin: 0 0 4px; font-family: Arial, sans-serif; font-size: 12px; color: #7A6A6E; text-align: center; letter-spacing: 0.04em;">
          PAYMENT STATUS &middot; <strong style="color: #2A1B1F;">${esc(data.paymentStatusLabel)}</strong>
        </p>
        ${data.paymentLines?.length ? moneyTable(data.paymentLines) : ""}
        ${
          data.balanceDue
            ? `<p class="muted" style="margin: 0; font-family: Arial, sans-serif; font-size: 13px; color: #7A6A6E; text-align: center;">Please bring <strong style="color: #2A1B1F;">${esc(data.balanceDue)}</strong> to your appointment.</p>`
            : ""
        }
        <p class="muted" style="margin: 16px 0 0; font-family: Arial, sans-serif; font-size: 12px; color: #7A6A6E; text-align: center;">Booking ${esc(data.bookingRef)}</p>
        ${data.bookingUrl ? button("View Appointment", data.bookingUrl, color) : ""}`,
    }),
  };
};

/** Sent when the studio moves an appointment. Leads with the NEW slot. */
export const bookingRescheduled = (
  brand: EmailBrand,
  data: BookingCore & {
    customerFirstName: string;
    previousDate: string;
    previousTime: string;
    reason?: string | null;
    bookingUrl?: string;
  },
) => {
  const color = brandColor(brand);
  return {
    subject: "Your appointment has been rescheduled",
    html: renderShell({
      brand,
      previewText: `Now ${data.date} at ${data.time}.`,
      documentType: "Appointment rescheduled",
      bodyHtml: `
        ${statusBadge("info", "RESCHEDULED")}
        <h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F; text-align: center;">Your appointment has moved</h1>
        <p style="margin: 0; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; line-height: 1.6; text-align: center;">
          ${esc(data.customerFirstName)}, ${esc(data.studioName)} has rescheduled your ${esc(data.serviceName)} appointment.
        </p>
        ${data.reason ? `<p class="muted" style="margin: 10px 0 0; font-family: Arial, sans-serif; font-size: 13px; color: #7A6A6E; text-align: center;">${esc(data.reason)}</p>` : ""}
        <p class="muted" style="margin: 20px 0 2px; font-family: Arial, sans-serif; font-size: 12px; color: #7A6A6E; text-align: center; letter-spacing: 0.04em;">PREVIOUSLY</p>
        <p class="muted" style="margin: 0 0 12px; font-family: Arial, sans-serif; font-size: 14px; color: #7A6A6E; text-align: center; text-decoration: line-through;">
          ${esc(data.previousDate)} &middot; ${esc(data.previousTime)}
        </p>
        <p class="muted" style="margin: 0 0 2px; font-family: Arial, sans-serif; font-size: 12px; color: #7A6A6E; text-align: center; letter-spacing: 0.04em;">NOW</p>
        ${appointmentCard({ serviceName: data.serviceName, date: data.date, time: data.time, duration: data.duration ?? null, studioName: data.studioName, color })}
        <p class="muted" style="margin: 0; font-family: Arial, sans-serif; font-size: 12px; color: #7A6A6E; text-align: center;">Booking ${esc(data.bookingRef)}</p>
        ${data.bookingUrl ? button("View Updated Appointment", data.bookingUrl, color) : ""}`,
    }),
  };
};

/**
 * Appointment reminders. One template, two windows — the only real difference
 * is urgency, and a separate near-identical template would drift.
 */
export const bookingReminder = (
  brand: EmailBrand,
  data: BookingCore & {
    customerFirstName: string;
    window: "24H" | "1H";
    balanceDue?: string | null;
    bookingUrl?: string;
  },
) => {
  const color = brandColor(brand);
  const soon = data.window === "1H";
  return {
    subject: soon
      ? "Your appointment starts in 1 hour"
      : "Your appointment is tomorrow",
    html: renderShell({
      brand,
      previewText: soon
        ? `${data.serviceName} at ${data.time}.`
        : `${data.serviceName} tomorrow at ${data.time}.`,
      documentType: "Appointment reminder",
      bodyHtml: `
        ${statusBadge("info", soon ? "STARTING SOON" : "TOMORROW")}
        <h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F; text-align: center;">
          ${soon ? `See you shortly, ${esc(data.customerFirstName)}` : `See you tomorrow, ${esc(data.customerFirstName)}`}
        </h1>
        ${appointmentCard({ serviceName: data.serviceName, date: data.date, time: data.time, duration: data.duration ?? null, studioName: data.studioName, color })}
        ${
          data.balanceDue
            ? `<p class="muted" style="margin: 0; font-family: Arial, sans-serif; font-size: 13px; color: #7A6A6E; text-align: center;">Please bring <strong style="color: #2A1B1F;">${esc(data.balanceDue)}</strong> with you.</p>`
            : ""
        }
        <p class="muted" style="margin: 14px 0 0; font-family: Arial, sans-serif; font-size: 12px; color: #7A6A6E; text-align: center;">Booking ${esc(data.bookingRef)}</p>
        ${data.bookingUrl ? button("View Appointment", data.bookingUrl, color) : ""}`,
    }),
  };
};

/**
 * Sent to the STUDIO when a customer asks to move their own booking. It is a
 * request, not a notification of a done deal — the slot is held but the
 * booking sits in PENDING_RESCHEDULE until the studio approves it.
 */
export const bookingRescheduleRequested = (
  brand: EmailBrand,
  data: BookingCore & {
    customerName: string;
    previousDate: string;
    previousTime: string;
    reason?: string | null;
    reviewUrl?: string;
  },
) => {
  const color = brandColor(brand);
  return {
    subject: `${data.customerName} asked to move their appointment`,
    html: renderShell({
      brand,
      previewText: `${data.serviceName}: ${data.previousDate} → ${data.date}.`,
      documentType: "Reschedule request",
      bodyHtml: `
        ${statusBadge("pending", "AWAITING YOUR APPROVAL")}
        <h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F; text-align: center;">Reschedule request</h1>
        <p style="margin: 0; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; line-height: 1.6; text-align: center;">
          <strong>${esc(data.customerName)}</strong> has asked to move their ${esc(data.serviceName)} appointment.
          The new slot is held for them until you approve or decline.
        </p>
        ${data.reason ? `<p class="muted" style="margin: 10px 0 0; font-family: Arial, sans-serif; font-size: 13px; color: #7A6A6E; text-align: center;">Their reason: ${esc(data.reason)}</p>` : ""}
        <p class="muted" style="margin: 20px 0 2px; font-family: Arial, sans-serif; font-size: 12px; color: #7A6A6E; text-align: center; letter-spacing: 0.04em;">WAS</p>
        <p class="muted" style="margin: 0 0 12px; font-family: Arial, sans-serif; font-size: 14px; color: #7A6A6E; text-align: center; text-decoration: line-through;">
          ${esc(data.previousDate)} &middot; ${esc(data.previousTime)}
        </p>
        <p class="muted" style="margin: 0 0 2px; font-family: Arial, sans-serif; font-size: 12px; color: #7A6A6E; text-align: center; letter-spacing: 0.04em;">REQUESTED</p>
        ${appointmentCard({ serviceName: data.serviceName, date: data.date, time: data.time, duration: data.duration ?? null, studioName: data.studioName, color })}
        <p class="muted" style="margin: 0; font-family: Arial, sans-serif; font-size: 12px; color: #7A6A6E; text-align: center;">Booking ${esc(data.bookingRef)}</p>
        ${data.reviewUrl ? button("Review Request", data.reviewUrl, color) : ""}`,
    }),
  };
};

/**
 * The booked service itself changed. Leads with the money, because that is the
 * part a customer needs to act on — a refund coming back, or a balance that
 * just grew.
 */
export const bookingServiceChanged = (
  brand: EmailBrand,
  data: BookingCore & {
    customerFirstName: string;
    previousServiceName: string;
    lines: MoneyLine[];
    refunded?: string | null;
    balanceDue?: string | null;
    bookingUrl?: string;
  },
) => {
  const color = brandColor(brand);
  return {
    subject: `Your booking has been updated to ${data.serviceName}`,
    html: renderShell({
      brand,
      previewText: `${data.previousServiceName} → ${data.serviceName}.`,
      documentType: "Booking updated",
      bodyHtml: `
        ${statusBadge("info", "SERVICE CHANGED")}
        <h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F; text-align: center;">Your booking has changed</h1>
        <p style="margin: 0; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; line-height: 1.6; text-align: center;">
          ${esc(data.customerFirstName)}, ${esc(data.studioName)} has updated your booking from
          <strong>${esc(data.previousServiceName)}</strong> to <strong>${esc(data.serviceName)}</strong>.
          Your appointment time is unchanged.
        </p>
        ${appointmentCard({ serviceName: data.serviceName, date: data.date, time: data.time, duration: data.duration ?? null, studioName: data.studioName, color })}
        ${moneyTable(data.lines)}
        ${
          data.refunded
            ? `<p style="margin: 0; font-family: Arial, sans-serif; font-size: 14px; color: #2A1B1F; text-align: center;">We're refunding <strong>${esc(data.refunded)}</strong> to the way you paid. It usually lands within 5–10 business days.</p>`
            : ""
        }
        ${
          data.balanceDue
            ? `<p style="margin: 0; font-family: Arial, sans-serif; font-size: 14px; color: #2A1B1F; text-align: center;">There's now <strong>${esc(data.balanceDue)}</strong> left to pay — you can settle it at the studio.</p>`
            : ""
        }
        <p class="muted" style="margin: 14px 0 0; font-family: Arial, sans-serif; font-size: 12px; color: #7A6A6E; text-align: center;">Booking ${esc(data.bookingRef)}</p>
        ${data.bookingUrl ? button("View Appointment", data.bookingUrl, color) : ""}`,
    }),
  };
};
