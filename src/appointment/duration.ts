/**
 * Service.duration is free text a studio types ("2 hrs", "1.5 hrs", "45 min"),
 * so it has to be parsed rather than read. Returns minutes, or null when the
 * text can't be understood — callers treat null as "unknown length" and fall
 * back to blocking only the exact slot, which is what the system did before
 * durations were considered at all.
 */
export const parseDurationMinutes = (
  duration: string | null | undefined,
): number | null => {
  if (!duration) return null;
  const text = duration.toLowerCase().trim();

  // "1h30", "1h 30m", "1:30"
  const combined =
    /^(\d+)\s*(?:h|hr|hrs|hour|hours|:)\s*(\d{1,2})\s*(?:m|min|mins|minutes)?$/.exec(
      text,
    );
  if (combined) {
    return Number(combined[1]) * 60 + Number(combined[2]);
  }

  const value = /(\d+(?:\.\d+)?)/.exec(text);
  if (!value) return null;
  const n = Number(value[1]);
  if (!Number.isFinite(n) || n <= 0) return null;

  if (/\b(m|min|mins|minute|minutes)\b/.test(text)) return Math.round(n);
  if (/\b(h|hr|hrs|hour|hours)\b/.test(text)) return Math.round(n * 60);
  if (/\b(d|day|days)\b/.test(text)) return Math.round(n * 24 * 60);
  // A bare number is ambiguous; hours is the friendlier reading for a salon
  // ("2" means two hours, not two minutes).
  return Math.round(n * 60);
};
