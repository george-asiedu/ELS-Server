import { Connection } from "../db/dbConnection";

export interface CommerceSettingsInput {
  enabled?: boolean;
  enablePickup?: boolean;
  enableDelivery?: boolean;
  deliveryFee?: number;
}

export class CommerceSettingsService extends Connection {
  // The shop policy is a single document; create it on first access.
  private async getOrCreate() {
    const existing = await this.commerceSettings.findFirst();
    if (existing) return existing;
    return this.commerceSettings.create({ data: {} });
  }

  public async get() {
    const settings = await this.getOrCreate();
    return {
      message: "Commerce settings retrieved successfully",
      data: settings,
    };
  }

  public async update(data: CommerceSettingsInput) {
    const current = await this.getOrCreate();

    let deliveryFee = data.deliveryFee;
    if (deliveryFee !== undefined) {
      deliveryFee = Math.max(0, deliveryFee);
    }

    const updated = await this.commerceSettings.update({
      where: { id: current.id },
      data: {
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
        ...(data.enablePickup !== undefined
          ? { enablePickup: data.enablePickup }
          : {}),
        ...(data.enableDelivery !== undefined
          ? { enableDelivery: data.enableDelivery }
          : {}),
        ...(deliveryFee !== undefined ? { deliveryFee } : {}),
      },
    });
    return { message: "Commerce settings updated successfully", data: updated };
  }
}
