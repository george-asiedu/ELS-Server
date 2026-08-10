import { Connection } from "../db/dbConnection";

export interface PaymentSettingsInput {
  enabled?: boolean;
  allowFull?: boolean;
  allowPartial?: boolean;
  depositPercent?: number;
}

export class PaymentSettingsService extends Connection {
  // The payment policy is a single document; create it on first access.
  private async getOrCreate() {
    const existing = await this.paymentSettings.findFirst();
    if (existing) return existing;
    return this.paymentSettings.create({ data: {} });
  }

  public async get() {
    const settings = await this.getOrCreate();
    return {
      message: "Payment settings retrieved successfully",
      data: settings,
    };
  }

  public async update(data: PaymentSettingsInput) {
    const current = await this.getOrCreate();

    let depositPercent = data.depositPercent;
    if (depositPercent !== undefined) {
      depositPercent = Math.min(100, Math.max(1, Math.round(depositPercent)));
    }

    const updated = await this.paymentSettings.update({
      where: { id: current.id },
      data: {
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
        ...(data.allowFull !== undefined ? { allowFull: data.allowFull } : {}),
        ...(data.allowPartial !== undefined
          ? { allowPartial: data.allowPartial }
          : {}),
        ...(depositPercent !== undefined ? { depositPercent } : {}),
      },
    });
    return { message: "Payment settings updated successfully", data: updated };
  }
}
