import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import { HttpCode } from "../models/status_codes";
import { toWhatsappNumber, WHATSAPP_NUMBER_HINT } from "../utils/whatsapp";

export interface ContactInfoInput {
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  instagram?: string | null;
  tiktok?: string | null;
  facebook?: string | null;
  address?: string | null;
  showPhone?: boolean;
  showWhatsapp?: boolean;
  showEmail?: boolean;
  showInstagram?: boolean;
  showTiktok?: boolean;
  showFacebook?: boolean;
  showAddress?: boolean;
}

const TEXT_FIELDS = {
  phone: 30,
  email: 120,
  instagram: 200,
  tiktok: 200,
  facebook: 200,
  address: 300,
} as const;

const SHOW_FIELDS = [
  "showPhone",
  "showWhatsapp",
  "showEmail",
  "showInstagram",
  "showTiktok",
  "showFacebook",
  "showAddress",
] as const;

const bad = (message: string) => new ApiError(message, HttpCode.BAD_REQUEST);

/**
 * Check and tidy what the admin sent. Only known fields get through, each with
 * the right type; empty text clears a field. The WhatsApp number is stored in
 * the international form a wa.me link needs, so the storefront's WhatsApp
 * buttons always open the right chat.
 */
const clean = (input: unknown) => {
  if (!input || typeof input !== "object")
    throw bad("Send the contact details to save");
  const body = input as Record<string, unknown>;
  const data: Record<string, string | boolean | null> = {};

  for (const [key, max] of Object.entries(TEXT_FIELDS)) {
    const v = body[key];
    if (v === undefined) continue;
    if (v !== null && typeof v !== "string") throw bad(`${key} must be text`);
    const text = v?.trim() || null;
    if (text && text.length > max)
      throw bad(`${key} must be at most ${max} characters`);
    data[key] = text;
  }
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email as string)) {
    throw bad("Enter a valid email address");
  }

  if (body.whatsapp !== undefined) {
    const v = body.whatsapp;
    if (v !== null && typeof v !== "string") throw bad("whatsapp must be text");
    const raw = v?.trim() ?? "";
    const number = raw ? toWhatsappNumber(raw) : null;
    if (raw && !number) throw bad(WHATSAPP_NUMBER_HINT);
    data.whatsapp = number;
  }

  for (const key of SHOW_FIELDS) {
    const v = body[key];
    if (v === undefined) continue;
    if (typeof v !== "boolean") throw bad(`${key} must be true or false`);
    data[key] = v;
  }
  return data as ContactInfoInput;
};

export class ContactService extends Connection {
  // The contact card set is a single document; create it on first access.
  private async getOrCreate() {
    const existing = await this.contactInfo.findFirst();
    if (existing) return existing;
    return this.contactInfo.create({ data: {} });
  }

  public async get() {
    const info = await this.getOrCreate();
    return { message: "Contact info retrieved successfully", data: info };
  }

  public async update(input: unknown) {
    const data = clean(input);
    const current = await this.getOrCreate();
    const updated = await this.contactInfo.update({
      where: { id: current.id },
      data,
    });
    return { message: "Contact info updated successfully", data: updated };
  }
}
