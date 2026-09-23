import { renderShell, button, esc, statusBadge, moneyTable, itemsTable, brandColor } from "../design/shell";
import { EmailBrand, MoneyLine } from "../types";

export const orderConfirmed = (
  brand: EmailBrand,
  data: {
    orderNumber: string;
    items: { name: string; quantity: number; total: string }[];
    lines: MoneyLine[]; // Subtotal / Discount? / Delivery? / Total
    fulfillment: "PICKUP" | "DELIVERY";
    viewUrl?: string;
  },
) => {
  const color = brandColor(brand);
  return {
    subject: "Your order is confirmed 🎉",
    html: renderShell({
      brand,
      previewText: `Order ${data.orderNumber} is confirmed.`,
      bodyHtml: `
        ${statusBadge("success", "ORDER CONFIRMED")}
        <h1 style="margin: 0 0 4px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F; text-align: center;">Thank you for your order!</h1>
        <p style="margin: 0 0 16px; font-family: Arial, sans-serif; font-size: 13px; color: #7A6A6E; text-align: center;">
          Order ${esc(data.orderNumber)} &middot; ${data.fulfillment === "DELIVERY" ? "Delivery" : "Pickup at studio"}
        </p>
        ${itemsTable(data.items)}
        ${moneyTable(data.lines)}
        ${data.viewUrl ? button("View Order", data.viewUrl, color) : ""}`,
    }),
  };
};

export const orderPaymentFailed = (
  brand: EmailBrand,
  data: { orderNumber: string; amountAttempted: string; retryUrl?: string },
) => {
  const color = brandColor(brand);
  return {
    subject: "Your order payment couldn't be completed",
    html: renderShell({
      brand,
      previewText: "Your order payment didn't go through.",
      bodyHtml: `
        ${statusBadge("error", "PAYMENT FAILED")}
        <h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F; text-align: center;">Payment not completed</h1>
        <p style="margin: 0; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; line-height: 1.6; text-align: center;">
          We couldn't process the payment of <strong>${esc(data.amountAttempted)}</strong> for order
          ${esc(data.orderNumber)}. No charge was made — your items are still in your cart.
        </p>
        ${data.retryUrl ? button("Try Payment Again", data.retryUrl, color) : ""}`,
    }),
  };
};

export const orderFulfilled = (
  brand: EmailBrand,
  data: { orderNumber: string; fulfillment: "PICKUP" | "DELIVERY"; viewUrl?: string },
) => {
  const color = brandColor(brand);
  const isPickup = data.fulfillment === "PICKUP";
  return {
    subject: isPickup ? "Your order is ready for pickup" : "Your order is on the way",
    html: renderShell({
      brand,
      previewText: isPickup ? "Ready for pickup." : "On its way to you.",
      bodyHtml: `
        ${statusBadge("info", isPickup ? "READY FOR PICKUP" : "OUT FOR DELIVERY")}
        <h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F; text-align: center;">
          ${isPickup ? "Your order is ready!" : "Your order is on the way"}
        </h1>
        <p style="margin: 0; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; line-height: 1.6; text-align: center;">
          Order ${esc(data.orderNumber)} — ${isPickup ? "come by whenever suits you." : "it should arrive soon."}
        </p>
        ${data.viewUrl ? button("View Order", data.viewUrl, color) : ""}`,
    }),
  };
};
