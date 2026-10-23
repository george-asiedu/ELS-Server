// WhatsApp numbers are stored the way wa.me links need them: the international
// number as digits only ("233245550142"). Same rules as the frontend's
// src/lib/whatsapp.ts, so whatever is saved here always makes a working link.

// Numbers written the local way (leading 0) are Ghanaian.
const DEFAULT_COUNTRY_CODE = "233";

/** International digits-only form, or null if the input can't be one. */
export const toWhatsappNumber = (raw: string): string | null => {
  const trimmed = raw.trim();
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  if (trimmed.startsWith("+")) {
    // Already international.
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (digits.startsWith("0")) {
    digits = DEFAULT_COUNTRY_CODE + digits.slice(1);
  } else if (digits.length === 9) {
    digits = DEFAULT_COUNTRY_CODE + digits;
  }
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
};

export const WHATSAPP_NUMBER_HINT =
  "Enter a WhatsApp number like 024 555 0142, or +44 7700 900123 for a number outside Ghana";
