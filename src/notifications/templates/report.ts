import { renderShell, button, esc, brandColor } from "../design/shell";
import { EmailBrand } from "../types";

export interface ReportFigure {
  label: string;
  value: string;
  /** Change against the month before, e.g. "+12%" or "−3"; null when there's nothing to compare. */
  change: string | null;
  /** Whether the change is good news (green) or not (red). */
  up?: boolean;
}

/**
 * Monthly report to a studio's (or store's) admins: a few figures for last
 * month with the change from the month before, the best seller, and a link to
 * the full analytics.
 */
export const monthlyReport = (
  brand: EmailBrand,
  data: {
    adminFirstName: string;
    studioName: string;
    monthLabel: string; // "October 2026"
    figures: ReportFigure[];
    highlights: string[]; // "Top service: Knotless braids (9 bookings)"
    analyticsUrl: string;
  },
) => {
  const color = brandColor(brand);
  const cell = (f: ReportFigure) => `
    <td width="50%" style="padding: 6px; vertical-align: top;">
      <div style="border: 1px solid #ECE4E6; border-radius: 12px; padding: 14px 16px;">
        <p style="margin: 0; font-family: Arial, sans-serif; font-size: 12px; color: #7A6A6E;">${esc(f.label)}</p>
        <p style="margin: 6px 0 0; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F;">${esc(f.value)}</p>
        ${
          f.change
            ? `<p style="margin: 4px 0 0; font-family: Arial, sans-serif; font-size: 12px; color: ${f.up === undefined ? "#7A6A6E" : f.up ? "#1F7A4D" : "#B4233A"};">${esc(f.change)} on last month</p>`
            : `<p style="margin: 4px 0 0; font-family: Arial, sans-serif; font-size: 12px; color: #7A6A6E;">&nbsp;</p>`
        }
      </div>
    </td>`;
  const rows: string[] = [];
  for (let i = 0; i < data.figures.length; i += 2) {
    rows.push(`<tr>${cell(data.figures[i]!)}${data.figures[i + 1] ? cell(data.figures[i + 1]!) : '<td width="50%"></td>'}</tr>`);
  }
  return {
    subject: `${data.studioName}: your ${data.monthLabel} report`,
    html: renderShell({
      brand,
      previewText: `How ${data.studioName} did in ${data.monthLabel}.`,
      documentType: "Monthly report",
      bodyHtml: `
        <h1 style="margin: 0 0 8px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F; text-align: center;">
          Your ${esc(data.monthLabel)} in numbers
        </h1>
        <p class="muted" style="margin: 0 0 18px; font-family: Arial, sans-serif; font-size: 14px; color: #7A6A6E; text-align: center;">
          Hi ${esc(data.adminFirstName)}, here's how ${esc(data.studioName)} did last month.
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;">
          ${rows.join("")}
        </table>
        ${
          data.highlights.length
            ? `<ul style="margin: 16px 0 0; padding: 0 0 0 18px; font-family: Arial, sans-serif; font-size: 14px; color: #2A1B1F; line-height: 1.7;">
                ${data.highlights.map((h) => `<li>${esc(h)}</li>`).join("")}
              </ul>`
            : ""
        }
        ${button("See your analytics", data.analyticsUrl, color)}`,
    }),
  };
};
