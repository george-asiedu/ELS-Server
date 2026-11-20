import {
  renderShell,
  button,
  esc,
  statusBadge,
  moneyTable,
  itemsTable,
  brandColor,
  receiptAttachedNotice,
  ReceiptDetails,
} from "../design/shell";
import { EmailBrand, MoneyLine } from "../types";

export const orderConfirmed = (
  brand: EmailBrand,
  data: {
    orderNumber: string;
    items: { name: string; quantity: number; total: string }[];
    lines: MoneyLine[]; // Subtotal / Discount? / Delivery? / Total
    fulfillment: "PICKUP" | "DELIVERY";
    // Orders are only confirmed after payment, so they always carry a receipt.
    receipt: ReceiptDetails;
    viewUrl?: string;
  },
) => {
  const color = brandColor(brand);
  return {
    subject: "Your order is confirmed",
    html: renderShell({
      brand,
      previewText: `Order ${data.orderNumber} is confirmed.`,
      documentType: "Order receipt",
      bodyHtml: `
        ${statusBadge("success", "ORDER CONFIRMED")}
        <h1 style="margin: 0 0 4px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F; text-align: center;">Thank you for your order</h1>
        <p class="muted" style="margin: 0 0 16px; font-family: Arial, sans-serif; font-size: 13px; color: #7A6A6E; text-align: center;">
          Order ${esc(data.orderNumber)} &middot; ${data.fulfillment === "DELIVERY" ? "Delivery" : "Pickup at studio"}
        </p>
        ${itemsTable(data.items)}
        ${moneyTable(data.lines)}
        ${receiptAttachedNotice(data.receipt, color)}
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
      documentType: "Payment failed",
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
  data: {
    orderNumber: string;
    fulfillment: "PICKUP" | "DELIVERY";
    viewUrl?: string;
  },
) => {
  const color = brandColor(brand);
  const isPickup = data.fulfillment === "PICKUP";
  return {
    subject: isPickup
      ? "Your order is ready for pickup"
      : "Your order is on the way",
    html: renderShell({
      brand,
      previewText: isPickup ? "Ready for pickup." : "On its way to you.",
      documentType: "Order update",
      bodyHtml: `
        ${statusBadge("info", isPickup ? "READY FOR PICKUP" : "OUT FOR DELIVERY")}
        <h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F; text-align: center;">
          ${isPickup ? "Your order is ready" : "Your order is on the way"}
        </h1>
        <p style="margin: 0; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; line-height: 1.6; text-align: center;">
          Order ${esc(data.orderNumber)} — ${isPickup ? "come by whenever suits you." : "it should arrive soon."}
        </p>
        ${data.viewUrl ? button("View Order", data.viewUrl, color) : ""}`,
    }),
  };
};

/**
 * Sent to the CUSTOMER as their order moves: being prepared, ready to collect,
 * or out for delivery. The handover code goes with the last two, so they can
 * confirm they've received it.
 */
export const orderStageUpdate = (
  brand: EmailBrand,
  data: {
    orderNumber: string;
    customerFirstName: string;
    stage: "PREPARING" | "READY_FOR_PICKUP" | "OUT_FOR_DELIVERY";
    eta?: string | null;
    handoverCode?: string | null;
    viewUrl?: string;
  },
) => {
  const copy = {
    PREPARING: {
      subject: `Your order ${data.orderNumber} is being prepared`,
      heading: "We're getting your order ready",
      body: "We've started preparing your order. We'll let you know when it's on its way or ready to collect.",
      push: `Order ${data.orderNumber} is being prepared.`,
    },
    READY_FOR_PICKUP: {
      subject: `Your order ${data.orderNumber} is ready to collect`,
      heading: "Your order is ready",
      body: "Your order is ready to collect. Show the code below when you pick it up.",
      push: `Order ${data.orderNumber} is ready to collect.`,
    },
    OUT_FOR_DELIVERY: {
      subject: `Your order ${data.orderNumber} is on its way`,
      heading: "Your order is on its way",
      body: "Your order is out for delivery. Give the rider the code below when it arrives, so we know it reached you.",
      push: `Order ${data.orderNumber} is on its way${data.eta ? ` (${data.eta})` : ""}.`,
    },
  }[data.stage];
  const code =
    data.stage !== "PREPARING" && data.handoverCode
      ? `<p style="margin: 20px 0 6px; font-family: Arial, sans-serif; font-size: 13px; color: #545B64;">Your handover code</p>
         <p style="margin: 0 0 8px; padding: 14px 18px; border: 1px dashed #C9CED6; display: inline-block; font-family: 'Courier New', monospace; font-size: 28px; font-weight: bold; letter-spacing: 8px;">${esc(data.handoverCode)}</p>`
      : "";
  return {
    subject: copy.subject,
    pushBody: copy.push,
    html: renderShell({
      brand,
      previewText: copy.push,
      documentType: "Order update",
      bodyHtml: `
        <h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F;">${esc(copy.heading)}</h1>
        <p style="margin: 0; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; line-height: 1.6;">
          Hi ${esc(data.customerFirstName)}, ${esc(copy.body.charAt(0).toLowerCase() + copy.body.slice(1))}
        </p>
        ${data.eta && data.stage !== "PREPARING" ? `<p style="margin: 12px 0 0; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F;">Expected: <strong>${esc(data.eta)}</strong></p>` : ""}
        ${code}
        <p class="muted" style="margin: 14px 0 0; font-family: Arial, sans-serif; font-size: 13px; color: #7A6A6E;">Order ${esc(data.orderNumber)}</p>
        ${data.viewUrl ? button("View your order", data.viewUrl, brandColor(brand)) : ""}`,
    }),
  };
};

/** The receipt for a bill a walk-in paid through its link. */
export const billReceipt = (
  brand: EmailBrand,
  data: {
    customerFirstName: string;
    studioName: string;
    number: string;
    lines: { name: string; quantity: number; total: string }[];
    total: string;
    paidOn: string;
  },
) => {
  return {
    subject: `Receipt ${data.number} from ${data.studioName}`,
    html: renderShell({
      brand,
      previewText: `You paid ${data.total} to ${data.studioName}`,
      documentType: "Payment receipt",
      bodyHtml: `
        <h1 style="margin: 0 0 12px; font-family: Georgia, serif; font-size: 22px; color: #2A1B1F;">Thank you, ${esc(data.customerFirstName)}</h1>
        <p style="margin: 0 0 8px; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; line-height: 1.6;">
          ${esc(data.studioName)} received your payment on ${esc(data.paidOn)}. Bill <strong>${esc(data.number)}</strong>.
        </p>
        ${itemsTable(data.lines)}
        ${moneyTable([{ label: "Total paid", value: data.total, emphasis: true }])}`,
    }),
  };
};

/** A bill sent to the customer, with the button to pay it. */
export const billIssued = (
  brand: EmailBrand,
  data: {
    customerFirstName: string;
    studioName: string;
    number: string;
    lines: { name: string; quantity: number; total: string }[];
    total: string;
    note: string | null;
    payUrl: string;
  },
) => ({
  subject: `Your bill from ${data.studioName}: ${data.total}`,
  html: renderShell({
    brand,
    previewText: `${data.studioName} sent you a bill for ${data.total}`,
    documentType: "Bill",
    bodyHtml: `
      <p style="margin: 0 0 12px; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; line-height: 1.6;">Hello ${esc(data.customerFirstName)},</p>
      <p style="margin: 0 0 8px; font-family: Arial, sans-serif; font-size: 15px; color: #2A1B1F; line-height: 1.6;">
        ${esc(data.studioName)} sent you bill <strong>${esc(data.number)}</strong>. You can pay it by Mobile Money or card.
      </p>
      ${itemsTable(data.lines)}
      ${moneyTable([{ label: "Total", value: data.total, emphasis: true }])}
      ${data.note ? `<p class="muted" style="margin: 0 0 8px; font-family: Arial, sans-serif; font-size: 13px; color: #7A6A6E;">${esc(data.note)}</p>` : ""}
      ${button("Pay now", data.payUrl, brandColor(brand))}`,
  }),
});
