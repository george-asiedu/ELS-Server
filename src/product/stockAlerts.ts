import { createTenantClient } from "../tenant/tenantClient";
import { notifyUsers } from "../push/pushService";

// Stock alerts: after a sale, admins hear (push and the notifications list)
// about any product that's now at or below the shop's low-stock level, once
// per run-down. Restocking above the level clears it, so the next run-down
// alerts again.

const { raw } = createTenantClient();

export const checkStockAlerts = async (
  studioId: string,
  productIds: string[],
) => {
  if (!productIds.length) return;
  const settings = await raw.commerceSettings.findUnique({
    where: { studioId },
    select: { lowStockThreshold: true },
  });
  const threshold = settings?.lowStockThreshold ?? 3;
  const products = await raw.product.findMany({
    where: {
      id: { in: productIds },
      studioId,
      trackStock: true,
      lowStockAlertedAt: null,
      stock: { lte: threshold },
    },
    select: { id: true, name: true, stock: true },
  });
  if (!products.length) return;
  const admins = await raw.user.findMany({
    where: { studioId, role: "ADMIN" },
    select: { id: true },
  });
  for (const p of products) {
    // Claim it, so two sales at once don't alert twice.
    const claimed = await raw.product.updateMany({
      where: { id: p.id, lowStockAlertedAt: null },
      data: { lowStockAlertedAt: new Date() },
    });
    if (claimed.count !== 1) continue;
    await notifyUsers(
      admins.map((a) => a.id),
      {
        title: p.stock <= 0 ? "Sold out" : "Running low",
        body:
          p.stock <= 0
            ? `${p.name} has sold out. Restock it to keep selling.`
            : `Only ${p.stock} of ${p.name} left.`,
        url: "/admin/products",
        tag: `stock:${p.id}`,
      },
    );
  }
};

/** After an admin edits stock: above the level again means alert next time. */
export const resetStockAlert = async (productId: string) => {
  const p = await raw.product.findUnique({
    where: { id: productId },
    select: { studioId: true, stock: true, lowStockAlertedAt: true },
  });
  if (!p?.lowStockAlertedAt || !p.studioId) return;
  const settings = await raw.commerceSettings.findUnique({
    where: { studioId: p.studioId },
    select: { lowStockThreshold: true },
  });
  if (p.stock > (settings?.lowStockThreshold ?? 3))
    await raw.product.update({
      where: { id: productId },
      data: { lowStockAlertedAt: null },
    });
};
