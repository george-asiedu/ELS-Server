import { randomUUID } from "crypto";
import { Connection } from "../db/dbConnection";
import { CursorPage, cursorPageArgs, cursorPageResult } from "../utils/cursorPagination";
import { ApiError } from "../middleware/apiError";
import { env } from "../config/env.config";
import { paystack, PaystackVerifyData } from "../payment/paystackClient";
import { AuditService } from "../audit/auditService";
import { LedgerService } from "../ledger/ledgerService";
import { safeClientOrigin } from "../utils/helper";
import { NotificationService } from "../notifications/notificationService";
import { NotificationTemplate } from "../notifications/registry";
import { orderConfirmed, orderPaymentFailed, orderFulfilled } from "../notifications/templates/shop";
import { EmailBrand, MoneyLine } from "../notifications/types";
import { ghs, receiptDate, receiptNumber } from "../notifications/format";

type FulfillmentType = "PICKUP" | "DELIVERY";

interface ItemSpec {
  productId: string;
  quantity: number;
}

interface LineItem {
  productId: string;
  name: string;
  unitPrice: number;
  costPrice: number;
  quantity: number;
}

interface Contact {
  name?: string | null;
  email: string;
  phone?: string | null;
}

export interface CheckoutInput {
  fulfillment: FulfillmentType;
  deliveryAddress?: string;
  deliveryPhone?: string;
  applyPoints?: boolean;
  referralCode?: string;
}

export interface GuestCheckoutInput {
  items: ItemSpec[];
  name: string;
  email: string;
  phone: string;
  fulfillment: FulfillmentType;
  deliveryAddress?: string;
  deliveryPhone?: string;
  referralCode?: string;
}

const orderInclude = { items: true } as const;

const effectivePrice = (p: { price: number; promoPrice: number | null }) =>
  p.promoPrice != null && p.promoPrice < p.price ? p.promoPrice : p.price;

export class OrderService extends Connection {
  private notifications = new NotificationService();
  private audit = new AuditService();
  private ledger = new LedgerService();

  private async brandForNotification(studioIdOverride?: string | null): Promise<EmailBrand> {
    const studio = await this.currentStudioBranding(studioIdOverride ?? undefined);
    return studio
      ? { kind: "studio", studio }
      : {
          kind: "zuri",
          zuri: { name: "Zuri Studios", websiteUrl: "https://zuristudios.com", supportEmail: "hello@zuristudios.com" },
        };
  }

  private static readonly POINTS_PER_GHS = 10; // 10 pts = GHS 1
  private static readonly REFERRAL_ORDER_BONUS = 50;

  private async settings() {
    const existing = await this.commerceSettings.findFirst();
    return existing ?? (await this.commerceSettings.create({ data: {} }));
  }

  private async userEmail(userId: string) {
    const user = await this.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return user?.email ?? null;
  }

  private async genOrderNumber(): Promise<string> {
    const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, "");
    for (let i = 0; i < 10; i++) {
      const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
      const candidate = `ORD-${stamp}-${rand}`;
      if (!(await this.order.findFirst({ where: { orderNumber: candidate } })))
        return candidate;
    }
    return `ORD-${stamp}-${randomUUID().slice(0, 6).toUpperCase()}`;
  }

  // Load products, validate availability, and snapshot pricing/cost.
  private async resolveLineItems(specs: ItemSpec[]): Promise<LineItem[]> {
    if (!specs.length) throw new ApiError("No products selected", 400);
    const items: LineItem[] = [];
    for (const spec of specs) {
      const qty = Math.max(1, Math.floor(spec.quantity || 1));
      const p = await this.product.findUnique({ where: { id: spec.productId } });
      if (!p || !p.active) {
        throw new ApiError("A selected product is no longer available", 400);
      }
      if (p.trackStock && qty > p.stock) {
        throw new ApiError(`Only ${p.stock} of "${p.name}" left in stock`, 400);
      }
      items.push({
        productId: p.id,
        name: p.name,
        unitPrice: effectivePrice(p),
        costPrice: p.costPrice ?? 0,
        quantity: qty,
      });
    }
    return items;
  }

  // Core order creation + Paystack initialization, shared by all checkout paths.
  private async createAndInitialize(params: {
    userId?: string | undefined;
    contact: Contact;
    lineItems: LineItem[];
    fulfillment: FulfillmentType;
    deliveryAddress?: string | undefined;
    deliveryPhone?: string | undefined;
    referralCode?: string | undefined;
    applyPoints?: boolean | undefined;
    appointmentId?: string | undefined;
    callbackPath: string;
    origin?: string | undefined;
  }) {
    const settings = await this.settings();
    if (!settings.enabled) {
      throw new ApiError("The shop is currently unavailable", 400);
    }
    const fulfillment =
      params.fulfillment === "DELIVERY" ? "DELIVERY" : "PICKUP";
    if (fulfillment === "PICKUP" && !settings.enablePickup) {
      throw new ApiError("Pickup is not available", 400);
    }
    if (fulfillment === "DELIVERY" && !settings.enableDelivery) {
      throw new ApiError("Delivery is not available", 400);
    }
    if (
      fulfillment === "DELIVERY" &&
      (!params.deliveryAddress?.trim() || !params.deliveryPhone?.trim())
    ) {
      throw new ApiError(
        "A delivery address and phone number are required for delivery",
        400,
      );
    }

    const subtotal =
      Math.round(
        params.lineItems.reduce((s, li) => s + li.unitPrice * li.quantity, 0) *
          100,
      ) / 100;

    // Loyalty redemption — customers only, capped at 30% of the subtotal.
    let discountAmount = 0;
    let pointsRedeemed = 0;
    if (params.userId && params.applyPoints) {
      const balance = await this.loyaltyPoints.findUnique({
        where: { userId: params.userId },
      });
      const available = balance?.points ?? 0;
      if (available > 0) {
        const capRatio = await this.loyaltyCapRatio();
        const maxByCap = Math.floor(
          subtotal * capRatio * OrderService.POINTS_PER_GHS,
        );
        pointsRedeemed = Math.min(available, maxByCap);
        discountAmount = pointsRedeemed / OrderService.POINTS_PER_GHS;
      }
    }

    const deliveryFee = fulfillment === "DELIVERY" ? settings.deliveryFee : 0;
    const total =
      Math.round((subtotal - discountAmount + deliveryFee) * 100) / 100;
    if (total <= 0) throw new ApiError("Order total must be greater than 0", 400);

    const reference = await this.makeReference("ORD");
    const orderNumber = await this.genOrderNumber();

    const order = await this.order.create({
      data: {
        orderNumber,
        ...(params.userId ? { userId: params.userId } : {}),
        customerName: params.contact.name ?? null,
        customerEmail: params.contact.email,
        customerPhone: params.contact.phone ?? null,
        subtotal,
        discountAmount,
        pointsRedeemed,
        deliveryFee,
        total,
        status: "PENDING_PAYMENT",
        fulfillment,
        deliveryAddress:
          fulfillment === "DELIVERY" ? params.deliveryAddress!.trim() : null,
        deliveryPhone:
          fulfillment === "DELIVERY" ? params.deliveryPhone!.trim() : null,
        referralCode: params.referralCode?.trim() || null,
        ...(params.appointmentId ? { appointmentId: params.appointmentId } : {}),
        reference,
        items: {
          create: params.lineItems.map((li) => ({
            productId: li.productId,
            name: li.name,
            unitPrice: li.unitPrice,
            costPrice: li.costPrice,
            quantity: li.quantity,
          })),
        },
      },
      include: orderInclude,
    });

    // Deduct redeemed points now (refunded if the order is cancelled).
    if (params.userId && pointsRedeemed > 0) {
      await this.loyaltyPoints.update({
        where: { userId: params.userId },
        data: { points: { decrement: pointsRedeemed } },
      });
      await this.loyaltyTransaction.create({
        data: {
          userId: params.userId,
          points: -pointsRedeemed,
          type: "REDEEMED",
          description: `Discount on order ${orderNumber}`,
        },
      });
    }

    await this.ledger.openAttempt({
      reference,
      expectedAmount: total,
      orderId: order.id,
      customerEmail: params.contact.email,
      customerName: params.contact.name ?? null,
    });

    const subaccount = await this.currentStudioSubaccount();
    const init = await paystack.initialize({
      email: params.contact.email,
      amountPesewas: Math.round(total * 100),
      reference,
      callbackUrl: `${safeClientOrigin(params.origin)}${params.callbackPath}`,
      metadata: { orderId: order.id, orderNumber, kind: "order" },
      subaccount,
    });

    return {
      message: "Order created",
      data: {
        authorizationUrl: init.authorization_url,
        accessCode: init.access_code,
        reference,
        orderId: order.id,
        orderNumber,
        total,
        email: params.contact.email,
        subaccount,
        publicKey: env.paystack.publicKey,
      },
    };
  }

  // Logged-in customer checkout from their saved cart.
  public async checkout(userId: string, input: CheckoutInput, origin?: string) {
    const cart = await this.cart.findUnique({
      where: { userId },
      include: { items: true },
    });
    if (!cart || cart.items.length === 0) {
      throw new ApiError("Your cart is empty", 400);
    }
    const lineItems = await this.resolveLineItems(
      cart.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
    );
    const email = await this.userEmail(userId);
    if (!email) throw new ApiError("An email is required to check out", 400);

    const profile = await this.profile.findUnique({ where: { userId } });

    return this.createAndInitialize({
      userId,
      contact: { name: profile?.fullName ?? null, email, phone: profile?.phone ?? null },
      lineItems,
      fulfillment: input.fulfillment,
      deliveryAddress: input.deliveryAddress,
      deliveryPhone: input.deliveryPhone,
      referralCode: input.referralCode,
      applyPoints: input.applyPoints,
      callbackPath: "/order/callback",
      origin,
    });
  }

  // Guest checkout (no account) for one or more products.
  public async guestCheckout(input: GuestCheckoutInput, origin?: string) {
    if (!input.email?.trim() || !input.name?.trim() || !input.phone?.trim()) {
      throw new ApiError("Name, email and phone are required", 400);
    }
    const lineItems = await this.resolveLineItems(input.items);
    return this.createAndInitialize({
      contact: {
        name: input.name.trim(),
        email: input.email.trim(),
        phone: input.phone.trim(),
      },
      lineItems,
      fulfillment: input.fulfillment,
      deliveryAddress: input.deliveryAddress,
      deliveryPhone: input.deliveryPhone,
      referralCode: input.referralCode,
      callbackPath: "/order/callback",
      origin,
    });
  }

  // Products bought as part of a booking. Creates the product order AND (if a
  // service amount is due now) the appointment payment, both sharing one
  // Paystack reference so a single charge covers service + products. Revenue is
  // split: the Payment record is booking revenue, the Order is product revenue.
  public async bookingCheckout(
    userId: string,
    input: {
      appointmentId: string;
      items: ItemSpec[];
      serviceType?: "FULL" | "PARTIAL";
      referralCode?: string;
    },
    origin?: string,
  ) {
    const appt = await this.appointment.findUnique({
      where: { id: input.appointmentId },
      include: { productOrders: true },
    });
    if (!appt) throw new ApiError("Appointment not found", 404);
    if (appt.userId !== userId) {
      throw new ApiError("You can only pay for your own booking", 403);
    }
    if (appt.productOrders.length > 0) {
      throw new ApiError("Products were already added to this booking", 400);
    }

    const commerce = await this.settings();
    if (!commerce.enabled) {
      throw new ApiError("The shop is currently unavailable", 400);
    }

    const lineItems = await this.resolveLineItems(input.items);
    const productSubtotal =
      Math.round(
        lineItems.reduce((s, li) => s + li.unitPrice * li.quantity, 0) * 100,
      ) / 100;

    const pay =
      (await this.paymentSettings.findFirst()) ??
      (await this.paymentSettings.create({ data: {} }));
    const amountDue = (appt.totalPrice ?? 0) - (appt.discountAmount ?? 0);

    let serviceDueNow = 0;
    let serviceType: "FULL" | "PARTIAL" = "FULL";
    if (pay.enabled && amountDue > 0) {
      const wantsPartial = input.serviceType === "PARTIAL";
      serviceType =
        wantsPartial && pay.allowPartial
          ? "PARTIAL"
          : pay.allowFull
            ? "FULL"
            : pay.allowPartial
              ? "PARTIAL"
              : "FULL";
      serviceDueNow =
        serviceType === "PARTIAL"
          ? Math.round(amountDue * (pay.depositPercent / 100) * 100) / 100
          : amountDue;
    }

    const combined = Math.round((serviceDueNow + productSubtotal) * 100) / 100;
    if (combined <= 0) throw new ApiError("Nothing to pay", 400);

    const email = await this.userEmail(userId);
    if (!email) throw new ApiError("An email is required to check out", 400);
    const profile = await this.profile.findUnique({ where: { userId } });

    const reference = await this.makeReference("ORD");
    const orderNumber = await this.genOrderNumber();

    // Service payment portion (booking revenue), sharing the reference.
    if (serviceDueNow > 0) {
      await this.payment.upsert({
        where: { appointmentId: appt.id },
        update: {
          amount: serviceDueNow,
          totalAmount: amountDue,
          type: serviceType,
          status: "PENDING",
          reference,
          currency: "GHS",
        },
        create: {
          appointmentId: appt.id,
          amount: serviceDueNow,
          totalAmount: amountDue,
          type: serviceType,
          status: "PENDING",
          reference,
          currency: "GHS",
        },
      });
    }

    // Product order portion (product revenue). Booking products are collected
    // at the studio with the appointment (pickup, no delivery fee).
    const order = await this.order.create({
      data: {
        orderNumber,
        userId,
        appointmentId: appt.id,
        customerName: profile?.fullName ?? appt.fullName,
        customerEmail: email,
        customerPhone: profile?.phone ?? appt.phone,
        subtotal: productSubtotal,
        deliveryFee: 0,
        total: productSubtotal,
        status: "PENDING_PAYMENT",
        fulfillment: "PICKUP",
        referralCode: input.referralCode?.trim() || null,
        reference,
        items: {
          create: lineItems.map((li) => ({
            productId: li.productId,
            name: li.name,
            unitPrice: li.unitPrice,
            costPrice: li.costPrice,
            quantity: li.quantity,
          })),
        },
      },
      include: orderInclude,
    });

    // One reference covers BOTH the service payment and the product order, so
    // the attempt links to both — either finalizer must be able to resolve it —
    // and its expected amount is the combined total Paystack will charge.
    const combinedPayment = await this.payment.findUnique({
      where: { appointmentId: appt.id },
      select: { id: true },
    });
    await this.ledger.openAttempt({
      reference,
      expectedAmount: combined,
      orderId: order.id,
      appointmentId: appt.id,
      ...(combinedPayment ? { paymentId: combinedPayment.id } : {}),
      customerEmail: email,
      customerName: order.customerName ?? null,
    });

    const subaccount = await this.currentStudioSubaccount();
    const init = await paystack.initialize({
      email,
      amountPesewas: Math.round(combined * 100),
      reference,
      callbackUrl: `${safeClientOrigin(origin)}/booking/callback`,
      metadata: { orderId: order.id, appointmentId: appt.id, kind: "booking" },
      subaccount,
    });

    return {
      message: "Booking payment initialized",
      data: {
        authorizationUrl: init.authorization_url,
        accessCode: init.access_code,
        reference,
        orderId: order.id,
        serviceDueNow,
        productSubtotal,
        total: combined,
        serviceType,
        email,
        subaccount,
        publicKey: env.paystack.publicKey,
      },
    };
  }

  public async listMine(userId: string, page: CursorPage) {
    const orders = await this.order.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: orderInclude,
      ...cursorPageArgs(page),
    });
    return { message: "Orders retrieved successfully", ...cursorPageResult(orders, page) };
  }

  public async listAll(page: CursorPage) {
    const orders = await this.order.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...cursorPageArgs(page),
      include: {
        items: true,
        user: {
          select: { email: true, profile: { select: { fullName: true } } },
        },
      },
    });
    return { message: "Orders retrieved successfully", ...cursorPageResult(orders, page) };
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

    // Refund redeemed points if a customer order is cancelled (once).
    if (
      status === "CANCELLED" &&
      order.userId &&
      order.pointsRedeemed > 0 &&
      !order.pointsRefunded
    ) {
      await this.loyaltyPoints.upsert({
        where: { userId: order.userId },
        update: { points: { increment: order.pointsRedeemed } },
        create: {
          userId: order.userId,
          points: order.pointsRedeemed,
          lifetimePoints: 0,
        },
      });
      await this.loyaltyTransaction.create({
        data: {
          userId: order.userId,
          points: order.pointsRedeemed,
          type: "REFUND",
          description: `Points refunded (order ${order.orderNumber} cancelled)`,
        },
      });
      await this.order.update({
        where: { id },
        data: { pointsRefunded: true },
      });
    }

    if (status === "FULFILLED" && order.customerEmail) {
      try {
        const brand = await this.brandForNotification(order.studioId);
        const { subject, html } = orderFulfilled(brand, {
          orderNumber: order.orderNumber,
          fulfillment: order.fulfillment as "PICKUP" | "DELIVERY",
          ...(brand.kind === "studio" && brand.studio.websiteUrl ? { viewUrl: brand.studio.websiteUrl } : {}),
        });
        await this.notifications.send({
          template: NotificationTemplate.SHOP_ORDER_FULFILLED,
          to: order.customerEmail,
          subject,
          html,
          studioId: order.studioId,
          entityType: "Order",
          entityId: order.id,
        });
      } catch (error) {
        console.error("Failed to send order-fulfilled email:", error);
      }
    }

    return { message: "Order status updated", data: order };
  }

  public async verify(reference: string) {
    const data = await paystack.verify(reference);
    const order = await this.finalizeByReference(reference, data);
    if (!order) throw new ApiError("Order not found", 404);
    return { message: "Order payment verified", data: order };
  }

  // Re-initialize payment for the customer's own still-unpaid order (retry after
  // a failed/abandoned charge). Issues a fresh reference and returns a new
  // Paystack access code for the inline popup.
  public async repay(userId: string, orderId: string, origin?: string) {
    const order = await this.order.findUnique({ where: { id: orderId } });
    if (!order || order.userId !== userId) {
      throw new ApiError("Order not found", 404);
    }
    if (order.status !== "PENDING_PAYMENT") {
      throw new ApiError("This order is no longer awaiting payment", 400);
    }
    const email = order.customerEmail ?? (await this.userEmail(userId));
    if (!email) throw new ApiError("An email is required to pay", 400);

    const reference = await this.makeReference("ORD");
    const subaccount = await this.currentStudioSubaccount();
    const init = await paystack.initialize({
      email,
      amountPesewas: Math.round(order.total * 100),
      reference,
      callbackUrl: `${safeClientOrigin(origin)}/order/callback`,
      metadata: { orderId: order.id, orderNumber: order.orderNumber, kind: "order" },
      subaccount,
    });
    await this.order.update({
      where: { id: order.id },
      data: { reference },
    });
    // The Order row's reference has just been rotated; the attempt preserves the
    // old one so a late completion of the previous checkout is still resolvable.
    await this.ledger.openAttempt({
      reference,
      expectedAmount: order.total,
      orderId: order.id,
      customerEmail: email,
      customerName: order.customerName ?? null,
    });
    await this.audit.record({
      actor: { email, role: "customer" },
      action: "payment.order.retried",
      targetType: "Order",
      targetId: order.id,
      studioId: order.studioId ?? undefined,
      metadata: {
        kind: "order",
        reference,
        orderNumber: order.orderNumber,
        amount: order.total,
        currency: "GHS",
      },
    });
    return {
      message: "Order payment restarted",
      data: {
        accessCode: init.access_code,
        reference,
        publicKey: env.paystack.publicKey,
      },
    };
  }

  // Idempotently marks a paid order: stock, cart, loyalty earn, referral, email.
  // Returns null when no order matches the reference (combined booking charges).
  public async finalizeByReference(
    reference: string,
    data: PaystackVerifyData,
  ) {
    // Same two-step resolution as bookings: the attempt row keeps a reference
    // that `repay` has since rotated off the Order, so a late completion of an
    // abandoned checkout still finds its order instead of being dropped.
    const attempt = await this.ledger.findAttempt(reference);
    let order = await this.order.findUnique({
      where: { reference },
      include: orderInclude,
    });
    if (!order && attempt?.orderId) {
      order = await this.order.findUnique({
        where: { id: attempt.orderId },
        include: orderInclude,
      });
    }
    if (!order) return null;

    const succeeded = data.status === "success";

    if (succeeded) {
      // Confirm Paystack charged what we asked before releasing stock/loyalty.
      const expectedAmount = attempt?.expectedAmount ?? order.total;
      const check = this.ledger.assertAmountMatches(
        expectedAmount,
        attempt?.currency ?? "GHS",
        data,
      );
      if (!check.ok) {
        await this.ledger.settleAttempt(reference, data, {
          status: "FAILED",
          failureReason: check.reason,
        });
        await this.audit.record({
          actor: { email: order.customerEmail ?? "system", role: "system" },
          action: "payment.order.amount_mismatch",
          targetType: "Order",
          targetId: order.id,
          studioId: order.studioId ?? undefined,
          metadata: {
            reference,
            reason: check.reason,
            expectedAmount,
            reportedAmountPesewas: data.amount,
            orderNumber: order.orderNumber,
          },
        });
        await this.ledger.post({
          studioId: order.studioId,
          type: "ORDER_PAYMENT",
          direction: "CREDIT",
          status: "FAILED",
          amount: Number(data.amount ?? 0) / 100,
          dedupeKey: `order:mismatch:${reference}`,
          reference,
          transactionId: String(data.id),
          description: `Rejected order ${order.orderNumber} (${check.reason})`,
          customerName: order.customerName ?? null,
          customerEmail: order.customerEmail ?? null,
          orderId: order.id,
          ...(attempt ? { paymentAttemptId: attempt.id } : {}),
        });
        throw new ApiError(
          "This payment could not be confirmed. Our team has been notified and " +
            "will be in touch about your order.",
          400,
        );
      }

      // Already settled by a different reference — a real second charge.
      if (order.status === "PAID" && order.reference !== reference) {
        await this.ledger.settleAttempt(reference, data, { status: "SUCCESS" });
        await this.audit.record({
          actor: { email: order.customerEmail ?? "system", role: "system" },
          action: "payment.order.duplicate_charge",
          targetType: "Order",
          targetId: order.id,
          studioId: order.studioId ?? undefined,
          metadata: {
            reference,
            settledReference: order.reference,
            orderNumber: order.orderNumber,
            amount: expectedAmount,
            note: "Customer charged twice for one order — refund required.",
          },
        });
        await this.ledger.post({
          studioId: order.studioId,
          type: "ORDER_PAYMENT",
          direction: "CREDIT",
          status: "SUCCESS",
          amount: expectedAmount,
          dedupeKey: `order:duplicate:${reference}`,
          reference,
          transactionId: String(data.id),
          description: `Duplicate payment for order ${order.orderNumber} — refund required`,
          customerName: order.customerName ?? null,
          customerEmail: order.customerEmail ?? null,
          orderId: order.id,
          occurredAt: data.paid_at ? new Date(data.paid_at) : null,
          ...(attempt ? { paymentAttemptId: attempt.id } : {}),
        });
        return order;
      }
    }
    if (!succeeded || order.status !== "PENDING_PAYMENT") {
      // Record a definitive failure (not a still-pending/abandoned check) so the
      // studio + platform have a trail of failed order payments.
      if (data.status === "failed" && order.status === "PENDING_PAYMENT") {
        await this.ledger.settleAttempt(reference, data, {
          status: "FAILED",
          failureReason: `Paystack reported "${data.status}"`,
        });
        await this.ledger.post({
          studioId: order.studioId,
          type: "ORDER_PAYMENT",
          direction: "CREDIT",
          status: "FAILED",
          amount: order.total,
          dedupeKey: `order:failed:${reference}`,
          reference,
          description: `Failed payment for order ${order.orderNumber}`,
          customerName: order.customerName ?? null,
          customerEmail: order.customerEmail ?? null,
          orderId: order.id,
          actorEmail: order.customerEmail ?? null,
          actorRole: "customer",
          ...(attempt ? { paymentAttemptId: attempt.id } : {}),
        });
        await this.audit.record({
          actor: { email: order.customerEmail ?? "system", role: "customer" },
          action: "payment.order.failed",
          targetType: "Order",
          targetId: order.id,
          studioId: order.studioId ?? undefined,
          metadata: {
            kind: "order",
            reference: order.reference,
            orderNumber: order.orderNumber,
            amount: order.total,
            currency: "GHS",
            status: data.status,
            customerName: order.customerName ?? null,
            customerEmail: order.customerEmail ?? null,
          },
        });
        if (order.customerEmail) {
          try {
            const brand = await this.brandForNotification(order.studioId);
            const { subject, html } = orderPaymentFailed(brand, {
              orderNumber: order.orderNumber,
              amountAttempted: ghs(order.total),
              ...(brand.kind === "studio" && brand.studio.websiteUrl ? { retryUrl: brand.studio.websiteUrl } : {}),
            });
            await this.notifications.send({
              template: NotificationTemplate.SHOP_ORDER_PAYMENT_FAILED,
              to: order.customerEmail,
              subject,
              html,
              studioId: order.studioId,
              entityType: "Order",
              entityId: order.id,
            });
          } catch (error) {
            console.error("Failed to send order-payment-failed email:", error);
          }
        }
      }
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

    await this.ledger.settleAttempt(reference, data, { status: "SUCCESS" });
    await this.ledger.post({
      studioId: paid.studioId,
      type: "ORDER_PAYMENT",
      direction: "CREDIT",
      status: "SUCCESS",
      amount: paid.total,
      dedupeKey: `order:paid:${reference}`,
      reference,
      transactionId: String(data.id),
      channel: data.channel ?? null,
      description: `Order ${paid.orderNumber}`,
      customerName: paid.customerName ?? null,
      customerEmail: paid.customerEmail ?? null,
      orderId: paid.id,
      actorEmail: paid.customerEmail ?? null,
      actorRole: "customer",
      occurredAt: data.paid_at ? new Date(data.paid_at) : null,
      ...(attempt ? { paymentAttemptId: attempt.id } : {}),
    });

    // Per-studio payment audit trail (best-effort).
    await this.audit.record({
      actor: { email: paid.customerEmail ?? "system", role: "customer" },
      action: "payment.order.succeeded",
      targetType: "Order",
      targetId: paid.id,
      studioId: paid.studioId ?? undefined,
      metadata: {
        kind: "order",
        reference: paid.reference,
        transactionId: paid.transactionId ?? String(data.id),
        orderNumber: paid.orderNumber,
        amount: paid.total,
        currency: "GHS",
        channel: paid.channel ?? data.channel ?? null,
        status: data.status,
        fulfillment: paid.fulfillment,
        customerName: paid.customerName ?? null,
        customerEmail: paid.customerEmail ?? null,
        itemCount: paid.items.length,
      },
    });

    // Decrement stock (never below zero).
    for (const item of paid.items) {
      if (!item.productId) continue;
      const product = await this.product.findUnique({
        where: { id: item.productId },
      });
      if (product?.trackStock) {
        await this.product.update({
          where: { id: product.id },
          data: { stock: Math.max(0, product.stock - item.quantity) },
        });
      }
    }

    // Clear the buyer's cart (customers only).
    if (order.userId) {
      const cart = await this.cart.findUnique({
        where: { userId: order.userId },
      });
      if (cart) await this.cartItem.deleteMany({ where: { cartId: cart.id } });

      // Earn loyalty on the product net (subtotal - discount), not delivery.
      const net = paid.subtotal - paid.discountAmount;
      const points = Math.floor(net / OrderService.POINTS_PER_GHS_EARN);
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
    }

    // Referral reward — 50 pts to the code owner, once per buyer (by email).
    await this.awardReferralReward(paid.referralCode, paid.customerEmail, order.userId);

    // Receipt email (best-effort).
    if (paid.customerEmail) {
      try {
        const brand = await this.brandForNotification(paid.studioId);
        const lines: MoneyLine[] = [
          { label: "Subtotal", value: ghs(paid.subtotal) },
          ...(paid.discountAmount > 0 ? [{ label: "Discount", value: `-${ghs(paid.discountAmount)}`, muted: true }] : []),
          ...(paid.deliveryFee > 0 ? [{ label: "Delivery", value: ghs(paid.deliveryFee) }] : []),
          { label: "Total", value: ghs(paid.total), emphasis: true },
        ];
        const paidTo =
          brand.kind === "studio" ? brand.studio.name : brand.zuri.name;
        const paidToEmail =
          brand.kind === "studio" ? brand.studio.email : brand.zuri.supportEmail;
        const { subject, html } = orderConfirmed(brand, {
          orderNumber: paid.orderNumber,
          items: paid.items.map((i) => ({
            name: i.name,
            quantity: i.quantity,
            total: ghs(i.unitPrice * i.quantity),
          })),
          lines,
          receipt: {
            receiptNumber: receiptNumber("RCP", paid.id),
            paidOn: receiptDate(paid.paidAt ?? null),
            method: paid.channel ?? null,
            reference: paid.reference ?? paid.orderNumber,
            transactionId: paid.transactionId ?? null,
            paidTo,
            paidToEmail: paidToEmail ?? null,
            amountPaid: ghs(paid.total),
            balanceDue: null,
          },
          fulfillment: paid.fulfillment as "PICKUP" | "DELIVERY",
          ...(brand.kind === "studio" && brand.studio.websiteUrl ? { viewUrl: brand.studio.websiteUrl } : {}),
        });
        await this.notifications.send({
          template: NotificationTemplate.SHOP_ORDER_CONFIRMED,
          to: paid.customerEmail,
          subject,
          html,
          studioId: paid.studioId,
          entityType: "Order",
          entityId: paid.id,
        });
      } catch (error) {
        console.error("Failed to send order receipt email:", error);
      }
    }

    return paid;
  }

  // 1 pt earned per GHS 10 spent on products.
  private static readonly POINTS_PER_GHS_EARN = 10;

  private async awardReferralReward(
    code: string | null,
    buyerEmail: string | null,
    buyerUserId: string | null,
  ) {
    if (!code || !buyerEmail) return;
    const referral = await this.referralCode.findFirst({ where: { code } });
    if (!referral) return;
    // No self-referral.
    if (buyerUserId && referral.userId === buyerUserId) return;
    const owner = await this.user.findUnique({
      where: { id: referral.userId },
      select: { email: true },
    });
    if (owner?.email?.toLowerCase() === buyerEmail.toLowerCase()) return;

    // Dedup: once per (code, buyer email).
    try {
      await this.referralOrderReward.create({
        data: { referralCodeId: referral.id, buyerEmail: buyerEmail.toLowerCase() },
      });
    } catch {
      return; // already rewarded for this buyer + code
    }

    const bonus = OrderService.REFERRAL_ORDER_BONUS;
    await this.loyaltyTransaction.create({
      data: {
        userId: referral.userId,
        points: bonus,
        type: "REFERRAL_BONUS",
        description: "Referral bonus — a friend shopped with your code",
      },
    });
    await this.loyaltyPoints.upsert({
      where: { userId: referral.userId },
      update: {
        points: { increment: bonus },
        lifetimePoints: { increment: bonus },
      },
      create: { userId: referral.userId, points: bonus, lifetimePoints: bonus },
    });
    await this.referralCode.update({
      where: { id: referral.id },
      data: { uses: { increment: 1 } },
    });
  }
}
