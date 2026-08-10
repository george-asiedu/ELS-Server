import { randomUUID } from "crypto";
import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import { env } from "../config/env.config";
import { paystack, PaystackVerifyData } from "../payment/paystackClient";
import { EmailService } from "../email/emailService";

type FulfillmentType = "PICKUP" | "DELIVERY";

export interface CheckoutInput {
  fulfillment: FulfillmentType;
  deliveryAddress?: string;
  deliveryPhone?: string;
}

const orderInclude = {
  items: true,
} as const;

const effectivePrice = (p: { price: number; promoPrice: number | null }) =>
  p.promoPrice != null && p.promoPrice < p.price ? p.promoPrice : p.price;

export class OrderService extends Connection {
  private email = new EmailService();

  private async settings() {
    const existing = await this.commerceSettings.findFirst();
    return existing ?? (await this.commerceSettings.create({ data: {} }));
  }

  private async genOrderNumber(): Promise<string> {
    const stamp = new Date()
      .toISOString()
      .slice(2, 10)
      .replace(/-/g, ""); // yymmdd
    for (let i = 0; i < 10; i++) {
      const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
      const candidate = `ORD-${stamp}-${rand}`;
      const clash = await this.order.findUnique({
        where: { orderNumber: candidate },
      });
      if (!clash) return candidate;
    }
    return `ORD-${stamp}-${randomUUID().slice(0, 6).toUpperCase()}`;
  }

  // Build an order from the user's cart and start a Paystack transaction.
  public async checkout(userId: string, input: CheckoutInput) {
    const settings = await this.settings();
    if (!settings.enabled) {
      throw new ApiError("The shop is currently unavailable", 400);
    }

    const fulfillment = input.fulfillment === "DELIVERY" ? "DELIVERY" : "PICKUP";
    if (fulfillment === "PICKUP" && !settings.enablePickup) {
      throw new ApiError("Pickup is not available", 400);
    }
    if (fulfillment === "DELIVERY" && !settings.enableDelivery) {
      throw new ApiError("Delivery is not available", 400);
    }
    if (fulfillment === "DELIVERY") {
      if (!input.deliveryAddress?.trim() || !input.deliveryPhone?.trim()) {
        throw new ApiError(
          "A delivery address and phone number are required for delivery",
          400,
        );
      }
    }

    const cart = await this.cart.findUnique({
      where: { userId },
      include: { items: { include: { product: true } } },
    });
    if (!cart || cart.items.length === 0) {
      throw new ApiError("Your cart is empty", 400);
    }

    // Validate availability and build snapshot line items.
    const lineItems = cart.items.map((item) => {
      const p = item.product;
      if (!p.active) {
        throw new ApiError(`"${p.name}" is no longer available`, 400);
      }
      if (p.trackStock && item.quantity > p.stock) {
        throw new ApiError(
          `Only ${p.stock} of "${p.name}" left in stock`,
          400,
        );
      }
      const unitPrice = effectivePrice(p);
      return {
        productId: p.id,
        name: p.name,
        unitPrice,
        quantity: item.quantity,
      };
    });

    const subtotal = lineItems.reduce(
      (sum, li) => sum + li.unitPrice * li.quantity,
      0,
    );
    const deliveryFee = fulfillment === "DELIVERY" ? settings.deliveryFee : 0;
    const total = Math.round((subtotal + deliveryFee) * 100) / 100;
    if (total <= 0) throw new ApiError("Order total must be greater than 0", 400);

    const email = await this.userEmail(userId);
    if (!email) throw new ApiError("An email is required to check out", 400);

    const reference = `ORD-${randomUUID()}`;
    const orderNumber = await this.genOrderNumber();

    const order = await this.order.create({
      data: {
        orderNumber,
        userId,
        subtotal,
        deliveryFee,
        total,
        status: "PENDING_PAYMENT",
        fulfillment,
        deliveryAddress:
          fulfillment === "DELIVERY" ? input.deliveryAddress!.trim() : null,
        deliveryPhone:
          fulfillment === "DELIVERY" ? input.deliveryPhone!.trim() : null,
        reference,
        items: { create: lineItems },
      },
      include: orderInclude,
    });

    const init = await paystack.initialize({
      email,
      amountPesewas: Math.round(total * 100),
      reference,
      callbackUrl: `${env.clientUrl}/order/callback`,
      metadata: { orderId: order.id, orderNumber, kind: "order" },
    });

    return {
      message: "Order created",
      data: {
        authorizationUrl: init.authorization_url,
        reference,
        orderId: order.id,
        orderNumber,
        total,
      },
    };
  }

  private async userEmail(userId: string) {
    const user = await this.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return user?.email ?? null;
  }

  public async listMine(userId: string) {
    const orders = await this.order.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: orderInclude,
    });
    return { message: "Orders retrieved successfully", data: orders };
  }

  public async listAll() {
    const orders = await this.order.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        items: true,
        user: { select: { email: true, profile: { select: { fullName: true } } } },
      },
    });
    return { message: "Orders retrieved successfully", data: orders };
  }

  public async updateStatus(id: string, status: string) {
    const allowed = ["PENDING_PAYMENT", "PAID", "FULFILLED", "CANCELLED"];
    if (!allowed.includes(status)) {
      throw new ApiError("Invalid order status", 400);
    }
    const existing = await this.order.findUnique({ where: { id } });
    if (!existing) throw new ApiError("Order not found", 404);
    const order = await this.order.update({
      where: { id },
      data: { status: status as never },
      include: orderInclude,
    });
    return { message: "Order status updated", data: order };
  }

  // Called from the browser after the Paystack redirect.
  public async verify(reference: string) {
    const data = await paystack.verify(reference);
    const order = await this.finalizeByReference(reference, data);
    return { message: "Order payment verified", data: order };
  }

  // Shared by verify + webhook. Idempotently marks the order paid, decrements
  // stock, clears the cart, awards loyalty and emails the receipt.
  public async finalizeByReference(
    reference: string,
    data: PaystackVerifyData,
  ) {
    const order = await this.order.findUnique({
      where: { reference },
      include: orderInclude,
    });
    if (!order) throw new ApiError("Order not found", 404);

    const succeeded = data.status === "success";
    if (!succeeded || order.status !== "PENDING_PAYMENT") {
      return order;
    }

    const paid = await this.order.update({
      where: { id: order.id },
      data: {
        status: "PAID",
        transactionId: String(data.id),
        channel: data.channel ?? null,
        paidAt: data.paid_at ? new Date(data.paid_at) : new Date(),
      },
      include: orderInclude,
    });

    // Decrement stock (never below zero) for tracked products.
    for (const item of paid.items) {
      if (!item.productId) continue;
      const product = await this.product.findUnique({
        where: { id: item.productId },
      });
      if (product?.trackStock) {
        const next = Math.max(0, product.stock - item.quantity);
        await this.product.update({
          where: { id: product.id },
          data: { stock: next },
        });
      }
    }

    // Clear the purchased cart.
    const cart = await this.cart.findUnique({ where: { userId: order.userId } });
    if (cart) {
      await this.cartItem.deleteMany({ where: { cartId: cart.id } });
    }

    // Earn loyalty points on the purchase (1 pt / GHS 10).
    const points = Math.floor(paid.total / 10);
    if (points > 0) {
      await this.loyaltyTransaction.create({
        data: {
          userId: order.userId,
          points,
          type: "EARNED",
          description: `Purchase — order ${paid.orderNumber}`,
        },
      });
      await this.loyaltyPoints.upsert({
        where: { userId: order.userId },
        update: {
          points: { increment: points },
          lifetimePoints: { increment: points },
        },
        create: { userId: order.userId, points, lifetimePoints: points },
      });
    }

    // Receipt email (best-effort).
    const email = await this.userEmail(order.userId);
    if (email) {
      try {
        await this.email.sendOrderReceipt(email, {
          orderNumber: paid.orderNumber,
          items: paid.items.map((i) => ({
            name: i.name,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
          })),
          subtotal: paid.subtotal,
          deliveryFee: paid.deliveryFee,
          total: paid.total,
          fulfillment: paid.fulfillment,
          reference: paid.reference ?? "",
        });
      } catch (error) {
        console.error("Failed to send order receipt email:", error);
      }
    }

    return paid;
  }
}
