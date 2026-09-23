import { randomBytes } from "crypto";

// No 0/O/1/I/L so references are easy to read out and type.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

// Short random id (default 10 chars ≈ 49 bits). References also have a DB
// unique constraint, so a (vanishingly unlikely) collision fails loudly.
export const shortId = (length = 10): string => {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
};
