import {
  renderShell,
  button,
  esc,
  statusBadge,
  brandColor,
} from "../design/shell";
import { EmailBrand } from "../types";

// Status copy, written for the studio owner rather than echoing the enum. Each
// entry carries the badge tone, the headline, and what it means for them.
const STATUS_COPY: Record<
  string,
  {
    badge: "success" | "info" | "warning" | "error";
    label: string;
    heading: string;
    body: string;
  }
> = {
  PLANNED: {
    badge: "info",
    label: "PLANNED",
    heading: "Your request is on the roadmap",
    body: "We've reviewed your request and added it to our plans. We'll let you know as soon as work starts on it.",
  },
  IN_PROGRESS: {
    badge: "info",
    label: "IN PROGRESS",
    heading: "We've started building this",
    body: "Work on your request is underway. We'll email you again the moment it's live for your studio.",
  },
  DONE: {
    badge: "success",
    label: "COMPLETED",
    heading: "Your request is live 🎉",
    body: "The feature you asked for has been built and is now available in your dashboard. Thank you for the suggestion — it made the product better.",
  },
  DECLINED: {
    badge: "warning",
    label: "NOT PLANNED",
    heading: "We won't be building this for now",
    body: "After reviewing it, this isn't something we're able to take on right now. That isn't a no forever — if it becomes possible we'll revisit it, and we'd still like to hear your other ideas.",
  },
  NEW: {
    badge: "info",
    label: "RECEIVED",
    heading: "We've received your request",
    body: "Your request is logged and waiting to be reviewed. We'll update you as it moves along.",
  },
};

export const featureRequestStatusCopy = (status: string) =>
  STATUS_COPY[status] ?? STATUS_COPY.NEW!;

/** Sent to the super admin when a studio submits a new feature request. */
export const featureRequestSubmitted = (
  brand: EmailBrand,
  data: {
    studioName: string;
    studioSlug: string;
    title: string;
    description: string;
    requestedByEmail?: string | null;
    reviewUrl: string;
  },
) => {
  const color = brandColor(brand);
  return {
    subject: `Feature request from ${data.studioName}: ${data.title}`,
    html: renderShell({
      brand,
      previewText: `${data.studioName} requested: ${data.title}`,
      bodyHtml: `
        ${statusBadge("info", "NEW FEATURE REQUEST")}
        <h1 style="margin: 0 0 4px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F; text-align: center;">${esc(data.title)}</h1>
        <p style="margin: 0 0 20px; font-family: Arial, sans-serif; font-size: 13px; color: #7A6A6E; text-align: center;">
          from <strong>${esc(data.studioName)}</strong> (${esc(data.studioSlug)})${
            data.requestedByEmail ? ` &middot; ${esc(data.requestedByEmail)}` : ""
          }
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 8px; border: 1px solid #EADFE1; border-radius: 12px;">
          <tr>
            <td style="padding: 18px 22px; font-family: Arial, sans-serif; font-size: 14px; color: #2A1B1F; line-height: 1.6; white-space: pre-line;">${esc(data.description)}</td>
          </tr>
        </table>
        ${button("Review Request", data.reviewUrl, color)}`,
    }),
  };
};

/** Sent to the studio admin whenever their request changes status. */
export const featureRequestStatusChanged = (
  brand: EmailBrand,
  data: {
    title: string;
    status: string;
    dashboardUrl?: string;
  },
) => {
  const color = brandColor(brand);
  const copy = featureRequestStatusCopy(data.status);
  return {
    subject:
      data.status === "DONE"
        ? `Your feature request is live: ${data.title}`
        : `Update on your feature request: ${data.title}`,
    html: renderShell({
      brand,
      previewText: `${data.title} — ${copy.label}`,
      bodyHtml: `
        ${statusBadge(copy.badge, copy.label)}
        <h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F; text-align: center;">${esc(copy.heading)}</h1>
        <p style="margin: 0 0 16px; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; line-height: 1.6; text-align: center;">
          ${esc(copy.body)}
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 8px; border: 1px solid #EADFE1; border-radius: 12px; border-left: 4px solid ${color};">
          <tr>
            <td style="padding: 16px 20px;">
              <p style="margin: 0 0 2px; font-family: Arial, sans-serif; font-size: 11px; color: #7A6A6E; letter-spacing: 0.04em;">YOUR REQUEST</p>
              <p style="margin: 0; font-family: Georgia, serif; font-size: 17px; font-weight: 700; color: #2A1B1F;">${esc(data.title)}</p>
            </td>
          </tr>
        </table>
        ${data.dashboardUrl ? button("Open Dashboard", data.dashboardUrl, color) : ""}`,
    }),
  };
};
