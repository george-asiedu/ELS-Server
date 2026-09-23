import { randomBytes } from "crypto";

// No 0/O/1/I/L so references are easy to read out and type.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

// Short studio code from the name's initials, max 4 chars:
// "Nailed By Zara" -> NBZ, "El's Beauty Studio" -> EBS. A single-word name uses
// its first 3 letters ("Glow" -> GLO). Falls back to the slug, then "STU".
export const studioCode = (name: string, slug?: string): string => {
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/gi, ""))
    .filter(Boolean);
  let code =
    words.length > 1
      ? words.map((w) => w[0]).join("")
      : (words[0] ?? "").slice(0, 3);
  if (!code && slug) code = slug.replace(/[^a-z0-9]/gi, "").slice(0, 3);
  return (code.slice(0, 4) || "STU").toUpperCase();
};

// Short random id (default 10 chars ≈ 49 bits). References also have a DB
// unique constraint, so a (vanishingly unlikely) collision fails loudly.
export const shortId = (length = 10): string => {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
};
