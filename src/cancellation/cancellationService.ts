import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import { NotificationService } from "../notifications/notificationService";
import { NotificationTemplate } from "../notifications/registry";
import { brandFromStudio, firstName, storefrontFallbackBrand } from "../notifications/brand";
import { refundedByStudio } from "../notifications/templates/refund";
import { notifyStudioAdmins, notifyUsers } from "../push/pushService";
import { getTenantContext } from "../tenant/context";

// Cancellations and refunds without moving money through the platform.
//
// A customer asks to cancel a booking or a paid order; the studio's admins get
// a notice and decide. Approving is the normal "Cancelled" status change. If
// the customer had paid, the studio pays them back itself (Mobile Money, cash,
// bank) and records it here with "Mark as refunded", which tells the customer.
// Payment refunds through Paystack stay off: they'd come out of the platform's
// balance, not the studio's (see refund/refundService.ts).

const round2 = (n: number) => Math.round(n * 100) / 100;
const bad = (message: string, code = 400) => new ApiError(message, code);

const cleanReason = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, 500) : null;

const cleanNote = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : null;

export class CancellationService extends Connection {
  private notifications = new NotificationService();

  private studioId() {
    const id = getTenantContext()?.studioId;
    if (!id) throw bad("Open your studio's own site to do this");
    return id;
  }

  // ---- Bookings

  /** The customer asks to cancel their own upcoming booking. */
  public async requestBookingCancel(userId: string, id: string, reason: unknown) {
    const appt = await this.appointment.findUnique({
      where: { id },
      include: { service: { select: { name: true } } },
    });
    if (!appt || appt.userId !== userId) throw bad("Booking not found", 404);
    if (!["PENDING", "CONFIRMED", "PENDING_RESCHEDULE"].includes(appt.status))
      throw bad("This booking can't be cancelled");
    if (appt.cancelRequestedAt) throw bad("You've already asked to cancel this booking");
    await this.appointment.update({
      where: { id },
      data: { cancelRequestedAt: new Date(), cancelRequestReason: cleanReason(reason) },
    });
    await notifyStudioAdmins(
      this.studioId(),
      { template: "BOOKING_CANCEL_REQUESTED", entityId: id },
      {
        title: "Cancellation request",
        body: `${appt.fullName} asked to cancel ${appt.service?.name ?? "their booking"} on ${appt.appointmentDate.toISOString().slice(0, 10)} at ${appt.appointmentTime}.`,
        url: "/admin/appointments?status=cancel_requested",
        tag: `cancel-request:${id}`,
      },
    ).catch((e) => console.warn("Cancel request notice failed:", (e as Error).message));
    return { message: "Your request has been sent. The studio will confirm the cancellation." };
  }

  /** The studio keeps the booking: the request is cleared and the customer told. */
  public async declineBookingCancel(id: string) {
    const appt = await this.appointment.findUnique({ where: { id } });
    if (!appt?.cancelRequestedAt) throw bad("There's no cancellation request on this booking");
    await this.appointment.update({
      where: { id },
      data: { cancelRequestedAt: null, cancelRequestReason: null },
    });
    if (appt.userId)
      await notifyUsers([appt.userId], {
        title: "Your booking stays in place",
        body: `The studio couldn't cancel your booking on ${appt.appointmentDate.toISOString().slice(0, 10)} at ${appt.appointmentTime}. Contact them if you have questions.`,
        url: "/account?tab=appointments",
      }).catch(() => 0);
    return { message: "Request declined. The customer has been told." };
  }

  /** Record that the studio paid the customer back for a cancelled booking. */
  public async markBookingRefunded(id: string, amountRaw: unknown, note: unknown) {
    const appt = await this.appointment.findUnique({
      where: { id },
      include: { payment: true, service: { select: { name: true } } },
    });
    if (!appt) throw bad("Booking not found", 404);
    if (appt.status !== "CANCELLED") throw bad("Cancel the booking first, then mark it as refunded");
    if (appt.refundedOutsideAt) throw bad("This booking is already marked as refunded");
    const paid = appt.payment && ["PAID", "PARTIALLY_REFUNDED"].includes(appt.payment.status)
      ? round2(appt.payment.amount - appt.payment.refundedAmount)
      : 0;
    if (paid <= 0) throw bad("The customer didn't pay for this booking in the app, so there's nothing to record");
    const amount = amountRaw === undefined || amountRaw === null || amountRaw === "" ? paid : round2(Number(amountRaw));
    if (!(amount > 0) || amount > paid) throw bad(`Enter an amount up to ${paid.toFixed(2)}`);

    await this.appointment.update({
      where: { id },
      data: { refundedOutsideAt: new Date(), refundedOutsideAmount: amount, refundedOutsideNote: cleanNote(note) },
    });
    await this.tellCustomerRefunded({
      userId: appt.userId,
      email: appt.email,
      name: appt.fullName,
      amount,
      what: appt.service?.name ?? "your booking",
      url: "/account?tab=transactions",
      entityId: `appointment:${id}`,
    });
    return { message: "Marked as refunded. The customer has been told." };
  }

  // ---- Orders

  /** The customer asks to cancel a paid order that hasn't been handed over. */
  public async requestOrderCancel(userId: string, id: string, reason: unknown) {
    const order = await this.order.findUnique({ where: { id } });
    if (!order || order.userId !== userId) throw bad("Order not found", 404);
    // Before it's on its way or ready to collect.
    if (order.status !== "PAID" && order.status !== "PREPARING")
      throw bad("Only orders that haven't been sent or made ready to collect can be cancelled");
    if (order.cancelRequestedAt) throw bad("You've already asked to cancel this order");
    await this.order.update({
      where: { id },
      data: { cancelRequestedAt: new Date(), cancelRequestReason: cleanReason(reason) },
    });
    await notifyStudioAdmins(
      this.studioId(),
      { template: "ORDER_CANCEL_REQUESTED", entityId: id, entityType: "Order" },
      {
        title: "Cancellation request",
        body: `${order.customerName ?? "A customer"} asked to cancel order #${order.orderNumber}.`,
        url: "/admin/orders?status=cancel_requested",
        tag: `order-cancel-request:${id}`,
      },
    ).catch((e) => console.warn("Order cancel request notice failed:", (e as Error).message));
    return { message: "Your request has been sent. The shop will confirm the cancellation." };
  }

  public async declineOrderCancel(id: string) {
    const order = await this.order.findUnique({ where: { id } });
    if (!order?.cancelRequestedAt) throw bad("There's no cancellation request on this order");
    await this.order.update({
      where: { id },
      data: { cancelRequestedAt: null, cancelRequestReason: null },
    });
    if (order.userId)
      await notifyUsers([order.userId], {
        title: "Your order stays in place",
        body: `The shop couldn't cancel order #${order.orderNumber}. Contact them if you have questions.`,
        url: "/account?tab=orders",
      }).catch(() => 0);
    return { message: "Request declined. The customer has been told." };
  }

  public async markOrderRefunded(id: string, amountRaw: unknown, note: unknown) {
    const order = await this.order.findUnique({ where: { id } });
    if (!order) throw bad("Order not found", 404);
    if (order.status !== "CANCELLED") throw bad("Cancel the order first, then mark it as refunded");
    if (order.refundedOutsideAt) throw bad("This order is already marked as refunded");
    if (!order.paidAt) throw bad("This order was never paid, so there's nothing to record");
    const paid = round2(order.total - order.refundedAmount);
    const amount = amountRaw === undefined || amountRaw === null || amountRaw === "" ? paid : round2(Number(amountRaw));
    if (!(amount > 0) || amount > paid) throw bad(`Enter an amount up to ${paid.toFixed(2)}`);

    await this.order.update({
      where: { id },
      data: { refundedOutsideAt: new Date(), refundedOutsideAmount: amount, refundedOutsideNote: cleanNote(note) },
    });
    await this.tellCustomerRefunded({
      userId: order.userId,
      email: order.customerEmail,
      name: order.customerName ?? "",
      amount,
      what: `order #${order.orderNumber}`,
      url: "/account?tab=orders",
      entityId: `order:${id}`,
    });
    return { message: "Marked as refunded. The customer has been told." };
  }

  // ---- Shared

  private async tellCustomerRefunded(args: {
    userId: string | null;
    email: string | null;
    name: string;
    amount: number;
    what: string;
    url: string;
    entityId: string;
  }) {
    const studio = await this.currentStudioBranding();
    const studioName = studio?.name ?? "The studio";
    if (args.email) {
      const { subject, html } = refundedByStudio(brandFromStudio(studio, storefrontFallbackBrand), {
        customerFirstName: firstName(args.name || "there"),
        studioName,
        amount: args.amount,
        what: args.what,
      });
      await this.notifications.send({
        template: NotificationTemplate.REFUNDED_BY_STUDIO,
        to: args.email,
        subject,
        html,
        studioId: getTenantContext()?.studioId ?? null,
        entityType: "Refund",
        entityId: args.entityId,
      });
    } else if (args.userId) {
      // No email on file: the in-app notice is all we can send.
      await notifyUsers([args.userId], {
        title: studioName,
        body: `${studioName} has refunded GHS ${args.amount.toFixed(2)} for ${args.what}.`,
        url: args.url,
      }).catch(() => 0);
    }
  }
}
