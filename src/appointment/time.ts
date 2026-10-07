/**
 * Appointment times are stored as the label the picker showed, which is
 * 12-hour ("10:00 AM", "1:00 PM") in the current booking UI — not 24-hour.
 * Admin tooling and the reschedule form send 24-hour ("14:30").
 *
 * Both are therefore live in the database at once, so every consumer has to go
 * through this parser rather than assume a format. Returns minutes since
 * midnight, or null when the text isn't a time at all.
 */
export const parseTimeMinutes = (
  raw: string | null | undefined,
): number | null => {
  if (!raw) return null;
  const text = raw.trim().toLowerCase();

  // 12-hour, with or without a space before the meridiem: "9:00am", "1:00 PM".
  const twelve = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/.exec(text);
  if (twelve) {
    let hour = Number(twelve[1]);
    const mins = Number(twelve[2] ?? 0);
    if (hour < 1 || hour > 12 || mins > 59) return null;
    // 12 AM is midnight and 12 PM is noon — the one case the usual +12 breaks.
    if (twelve[3] === "am") hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
    return hour * 60 + mins;
  }

  // 24-hour, tolerating a missing leading zero ("9:00" as well as "09:00").
  const twentyFour = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (twentyFour) {
    const hour = Number(twentyFour[1]);
    const mins = Number(twentyFour[2]);
    if (hour > 23 || mins > 59) return null;
    return hour * 60 + mins;
  }

  return null;
};

/** Minutes since midnight back to a 24-hour "HH:MM" label. */
export const formatTimeHHMM = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** True when two times mean the same moment regardless of how they're written. */
export const sameTime = (a: string, b: string): boolean => {
  const x = parseTimeMinutes(a);
  const y = parseTimeMinutes(b);
  return x !== null && x === y;
};
