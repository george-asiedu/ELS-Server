// A Google Calendar link for the free live training session.

const stamp = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

export interface SessionEvent {
  uid: string;
  title: string;
  start: Date;
  minutes: number;
  description: string;
  url: string | null;
}

export const googleCalendarUrl = (e: SessionEvent): string => {
  const end = new Date(e.start.getTime() + e.minutes * 60_000);
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates: `${stamp(e.start)}/${stamp(end)}`,
    details: `${e.description}${e.url ? `\n\nJoin: ${e.url}` : ""}`,
    ...(e.url ? { location: e.url } : {}),
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
};

/** "Tuesday 2 December 2026, 4:00 pm" in Ghana time (GMT all year). */
export const whenText = (d: Date): string =>
  `${d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })}, ${d
    .toLocaleTimeString("en-GB", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "UTC",
    })
    .replace(/\s?(am|pm)/i, (m) => ` ${m.trim().toLowerCase()}`)} (Ghana time)`;
