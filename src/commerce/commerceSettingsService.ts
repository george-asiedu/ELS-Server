import { Connection } from "../db/dbConnection";

export interface CommerceSettingsInput {
  enabled?: boolean;
  enablePickup?: boolean;
  enableDelivery?: boolean;
  deliveryFee?: number;
  lowStockThreshold?: number;
  deliveryZones?: unknown;
  deliverySlots?: unknown;
}

export interface DeliveryZone { id: string; name: string; fee: number }

/** Clean an admin's list of delivery areas: named, non-negative fees, at most 30. */
export const cleanZones = (v: unknown): DeliveryZone[] => {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: DeliveryZone[] = [];
  for (const z of v.slice(0, 30)) {
    const name = typeof z?.name === "string" ? z.name.trim().slice(0, 60) : "";
    const fee = Math.round(Math.max(0, Number(z?.fee) || 0) * 100) / 100;
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const id = typeof z?.id === "string" && /^[\w-]{1,40}$/.test(z.id) ? z.id : Math.random().toString(36).slice(2, 10);
    out.push({ id, name, fee });
  }
  return out;
};

export const cleanSlots = (v: unknown): string[] =>
  Array.isArray(v)
    ? [...new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, 40)).filter(Boolean))].slice(0, 8)
    : [];

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
        ...(data.deliveryZones !== undefined ? { deliveryZones: cleanZones(data.deliveryZones) as never } : {}),
        ...(data.deliverySlots !== undefined ? { deliverySlots: cleanSlots(data.deliverySlots) as never } : {}),
        ...(data.lowStockThreshold !== undefined && Number.isFinite(Number(data.lowStockThreshold))
          ? { lowStockThreshold: Math.max(0, Math.min(1000, Math.trunc(Number(data.lowStockThreshold)))) }
          : {}),
      },
    });
    return { message: "Commerce settings updated successfully", data: updated };
  }
}
