// A calendar entry for the free live training session: an .ics file (opens in
// Apple, Google, Outlook and phone calendars) and a Google Calendar link.

const stamp = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

// RFC 5545: escape commas, semicolons, backslashes and newlines in text.
const esc = (s: string) =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");

// Lines longer than 75 bytes are folded onto the next line, starting with a space.
const fold = (line: string) => {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  out.push(rest);
  return out.join("\r\n");
};

export interface SessionEvent {
  uid: string;
  title: string;
  start: Date;
  minutes: number;
  description: string;
  url: string | null;
}

export const buildIcs = (e: SessionEvent): string => {
  const end = new Date(e.start.getTime() + e.minutes * 60_000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Zuri//Training//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(e.start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(e.title)}`,
    `DESCRIPTION:${esc(e.description)}`,
    ...(e.url ? [`URL:${e.url}`, `LOCATION:${esc(e.url)}`] : []),
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Zuri live training starts soon",
    "TRIGGER:-PT15M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
};

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
