import { Connection } from "../db/dbConnection";

export interface ContactInfoInput {
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  instagram?: string | null;
  tiktok?: string | null;
  address?: string | null;
  showPhone?: boolean;
  showWhatsapp?: boolean;
  showEmail?: boolean;
  showInstagram?: boolean;
  showTiktok?: boolean;
  showAddress?: boolean;
}

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

  public async update(data: ContactInfoInput) {
    const current = await this.getOrCreate();
    const updated = await this.contactInfo.update({
      where: { id: current.id },
      data: {
        ...(data.phone !== undefined ? { phone: data.phone } : {}),
        ...(data.whatsapp !== undefined ? { whatsapp: data.whatsapp } : {}),
        ...(data.email !== undefined ? { email: data.email } : {}),
        ...(data.instagram !== undefined ? { instagram: data.instagram } : {}),
        ...(data.tiktok !== undefined ? { tiktok: data.tiktok } : {}),
        ...(data.address !== undefined ? { address: data.address } : {}),
        ...(data.showPhone !== undefined ? { showPhone: data.showPhone } : {}),
        ...(data.showWhatsapp !== undefined ? { showWhatsapp: data.showWhatsapp } : {}),
        ...(data.showEmail !== undefined ? { showEmail: data.showEmail } : {}),
        ...(data.showInstagram !== undefined ? { showInstagram: data.showInstagram } : {}),
        ...(data.showTiktok !== undefined ? { showTiktok: data.showTiktok } : {}),
        ...(data.showAddress !== undefined ? { showAddress: data.showAddress } : {}),
      },
    });
    return { message: "Contact info updated successfully", data: updated };
  }
}
