import { Connection } from "../db/dbConnection";
import { CursorPage, cursorPageArgs, cursorPageResult } from "../utils/cursorPagination";
import { getTenantContext, runAsSuperAdmin } from "../tenant/context";
import { ApiError } from "../middleware/apiError";
import { S3BucketService } from "../bucket/s3BucketService";
import {
  AppointmentStatusInput,
  CreateAppointmentInput,
} from "./appointmentModels";
import { NotificationService } from "../notifications/notificationService";
import { NotificationTemplate } from "../notifications/registry";
import {
  bookingRequestCustomer,
  bookingRequestStudio,
  bookingCompleted,
  bookingCancelled,
  bookingConfirmed,
  bookingRescheduled,
  bookingReminder,
} from "../notifications/templates/booking";
import { EmailBrand, MoneyLine } from "../notifications/types";
import { ghs } from "../notifications/format";

// A short, human-friendly reference derived from the real record id (not a
// separately-tracked field) — e.g. "APT-4F9C2A1B".
const shortRef = (prefix: string, id: string) =>
  `${prefix}-${id.slice(-8).toUpperCase()}`;

const formatDate = (d: Date) =>
  d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric" });

/**
 * Where a booking stands on money, derived from the payment row rather than
 * from the booking's own status. Booking state and payment state are
 * independent: a CONFIRMED appointment can be unpaid, and a PENDING one can be
 * paid in full.
 */
const paymentView = (
  payment: { amount: number; totalAmount: number; status: string } | null | undefined,
  amountDue: number,
): {
  label: "UNPAID" | "PARTIALLY PAID" | "PAID IN FULL";
  lines: MoneyLine[];
  balanceDue: string | null;
} => {
  const paid = payment && payment.status === "PAID" ? payment.amount : 0;
  const total = payment?.totalAmount || amountDue || 0;
  const balance = Math.max(0, Math.round((total - paid) * 100) / 100);

  if (paid <= 0) {
    return {
      label: "UNPAID",
      lines: total > 0 ? [{ label: "Amount due", value: ghs(total) }] : [],
      balanceDue: total > 0 ? ghs(total) : null,
    };
  }
  if (balance > 0) {
    return {
      label: "PARTIALLY PAID",
      lines: [
        { label: "Total", value: ghs(total) },
        { label: "Paid", value: ghs(paid) },
        { label: "Balance due", value: ghs(balance), emphasis: true },
      ],
      balanceDue: ghs(balance),
    };
  }
  return {
    label: "PAID IN FULL",
    lines: [
      { label: "Total", value: ghs(total) },
      { label: "Paid", value: ghs(paid) },
    ],
    balanceDue: null,
  };
};

const serviceInclude = {
  service: {
    select: {
      id: true,
      name: true,
      duration: true,
      price: true,
      category: true,
    },
  },
  payment: {
    select: {
      // The id and running refund total are what the admin UI needs to offer a
      // refund and show how much is left to give back.
      id: true,
      amount: true,
      totalAmount: true,
      refundedAmount: true,
      type: true,
      status: true,
      reference: true,
      channel: true,
      paidAt: true,
    },
  },
} as const;

export class AppointmentService extends Connection {
  private s3 = new S3BucketService();
  private notifications = new NotificationService();

  // Loyalty value for booking-time redemption. The discount cap ratio comes
  // from the studio's settings (loyaltyCapRatio()).
  private static readonly POINTS_PER_GHS = 10; // 10 points = GHS 1 off

  public async create(
    data: CreateAppointmentInput,
    userId?: string,
  ) {
    const service = await this.service.findUnique({
      where: { id: data.serviceId },
    });
    if (!service) {
      throw new ApiError("Selected service not found", 404);
    }

    let designImageUrl: string | undefined;
    if (data.designImageUrl) designImageUrl = this.s3.assertOwnedMediaUrl(data.designImageUrl, "appointments");

    // A service on promo bills at its promo price.
    const onPromo =
      service.promoPrice != null && service.promoPrice < service.price;
    const effectivePrice = onPromo ? service.promoPrice! : service.price;

    // Apply loyalty points as a discount (logged-in users only, capped at 30%).
    // Points can't be combined with a promo — the price is already reduced.
    let discountAmount = 0;
    let pointsRedeemed = 0;
    if (userId && data.applyPoints === "true" && !onPromo) {
      const balance = await this.loyaltyPoints.findUnique({ where: { userId } });
      const available = balance?.points ?? 0;
      if (available > 0) {
        const capRatio = await this.loyaltyCapRatio();
        const maxPointsByCap = Math.floor(
          effectivePrice * capRatio * AppointmentService.POINTS_PER_GHS,
        );
        pointsRedeemed = Math.min(available, maxPointsByCap);
        discountAmount = pointsRedeemed / AppointmentService.POINTS_PER_GHS;
      }
    }

    const appointment = await this.appointment.create({
      data: {
        fullName: data.fullName,
        phone: data.phone,
        email: data.email ?? null,
        appointmentDate: new Date(`${data.appointmentDate}T00:00:00.000Z`),
        appointmentTime: data.appointmentTime,
        notes: data.notes ?? null,
        totalPrice: effectivePrice,
        discountAmount,
        pointsRedeemed,
        serviceId: data.serviceId,
        ...(designImageUrl ? { designImageUrl } : {}),
        ...(userId ? { userId } : {}),
      },
      include: serviceInclude,
    });

    // Deduct the redeemed points now that we have the appointment id.
    if (userId && pointsRedeemed > 0) {
      await this.loyaltyPoints.update({
        where: { userId },
        data: { points: { decrement: pointsRedeemed } },
      });
      await this.loyaltyTransaction.create({
        data: {
          userId,
          points: -pointsRedeemed,
          type: "REDEEMED",
          description: `Discount on ${service.name} booking`,
          appointmentId: appointment.id,
        },
      });
    }

    // Booking-request notifications (best-effort — never block the booking):
    // the customer's confirmation, and a heads-up to the studio owner.
    try {
      const studio = await this.currentStudioBranding();
      const brand: EmailBrand = studio
        ? { kind: "studio", studio }
        : { kind: "zuri", zuri: { name: "Zuri Studios", websiteUrl: "https://zuristudios.com", supportEmail: "hello@zuristudios.com" } };
      const paymentRequired = (await this.paymentSettings.findFirst())?.enabled ?? false;
      const core = {
        serviceName: appointment.service?.name ?? "your service",
        date: formatDate(appointment.appointmentDate),
        time: appointment.appointmentTime,
        duration: appointment.service?.duration ?? null,
        studioName: studio?.name ?? "the studio",
        bookingRef: shortRef("APT", appointment.id),
      };

      if (appointment.email) {
        const { subject, html } = bookingRequestCustomer(brand, {
          ...core,
          customerFirstName: appointment.fullName.split(" ")[0] || appointment.fullName,
          paymentRequired,
          ...(studio?.bookingUrl ? { bookingUrl: studio.bookingUrl } : {}),
        });
        await this.notifications.send({
          template: NotificationTemplate.BOOKING_REQUEST_CUSTOMER,
          to: appointment.email,
          subject,
          html,
          studioId: getTenantContext()?.studioId ?? null,
          entityType: "Appointment",
          entityId: appointment.id,
        });
      }

      const studioEmail = await this.currentStudioNotifyEmail();
      if (studioEmail) {
        const { subject, html } = bookingRequestStudio(brand, {
          ...core,
          customerName: appointment.fullName,
          customerPhone: appointment.phone,
          ...(appointment.email ? { customerEmail: appointment.email } : {}),
          ...(appointment.notes ? { notes: appointment.notes } : {}),
          ...(appointment.designImageUrl ? { designImageUrl: appointment.designImageUrl } : {}),
        });
        await this.notifications.send({
          template: NotificationTemplate.BOOKING_REQUEST_STUDIO,
          to: studioEmail,
          subject,
          html,
          studioId: getTenantContext()?.studioId ?? null,
          entityType: "Appointment",
          entityId: appointment.id,
        });
      }
    } catch (error) {
      console.error("Failed to send booking-request notifications:", error);
    }

    return { message: "Appointment created successfully", data: appointment };
  }

  // Times already taken (any non-cancelled appointment) for a given date.
  /**
   * Send appointment reminders. Run on a schedule (see queue/index.ts): the
   * 24h sweep hourly, the 1h sweep every 15 minutes.
   *
   * Runs across every studio, so it must run in the super-admin context —
   * scoped models would otherwise fail closed outside a request.
   *
   * Duplicate suppression is the NotificationLog's job, not a flag on the
   * appointment: the entity key is `${id}:${window}`, so an overlapping sweep
   * (or a redeploy that re-fires the schedule) cannot send the same reminder
   * twice, and the two windows never collide with each other.
   */
  public async sendDueReminders(window: "24H" | "1H") {
    return runAsSuperAdmin(async () => {
      const now = Date.now();
      // Each sweep covers the span until the next one runs, so no appointment
      // falls between two passes. Generous on the near edge: a reminder a few
      // minutes late is fine, one that never arrives is not.
      const [from, to] =
        window === "24H"
          ? [now + 23 * 60 * 60 * 1000, now + 25 * 60 * 60 * 1000]
          : [now + 30 * 60 * 1000, now + 90 * 60 * 1000];

      // appointmentDate is a date at midnight UTC and appointmentTime a "HH:MM"
      // string, so the exact moment can only be reconstructed in JS. Scan the
      // days the window touches, then filter precisely below.
      const dayStart = new Date(new Date(from).setUTCHours(0, 0, 0, 0));
      const dayEnd = new Date(new Date(to).setUTCHours(23, 59, 59, 999));

      const candidates = await this.appointment.findMany({
        where: {
          appointmentDate: { gte: dayStart, lte: dayEnd },
          status: { in: ["PENDING", "CONFIRMED"] },
          email: { not: null },
        },
        include: serviceInclude,
      });

      let sent = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const appt of candidates) {
        const [hh, mm] = appt.appointmentTime.split(":");
        const at = new Date(appt.appointmentDate);
        at.setUTCHours(Number(hh ?? 0), Number(mm ?? 0), 0, 0);
        const ms = at.getTime();
        if (Number.isNaN(ms) || ms < from || ms > to) {
          skipped++;
          continue;
        }

        try {
          const studio = await this.currentStudioBranding(
            appt.studioId ?? undefined,
          );
          const brand: EmailBrand = studio
            ? { kind: "studio", studio }
            : { kind: "zuri", zuri: { name: "Zuri Studios", websiteUrl: "https://zuristudios.com", supportEmail: "hello@zuristudios.com" } };

          const payment = await this.payment.findUnique({
            where: { appointmentId: appt.id },
            select: { amount: true, totalAmount: true, status: true },
          });
          const amountDue =
            (appt.totalPrice ?? 0) - (appt.discountAmount ?? 0);
          const view = paymentView(payment, amountDue);

          const { subject, html } = bookingReminder(brand, {
            serviceName: appt.service?.name ?? "your service",
            date: formatDate(appt.appointmentDate),
            time: appt.appointmentTime,
            duration: appt.service?.duration ?? null,
            studioName: studio?.name ?? "the studio",
            bookingRef: shortRef("APT", appt.id),
            customerFirstName: appt.fullName.split(" ")[0] || appt.fullName,
            window,
            ...(view.balanceDue ? { balanceDue: view.balanceDue } : {}),
            ...(studio?.bookingUrl ? { bookingUrl: studio.bookingUrl } : {}),
          });

          await this.notifications.send({
            template:
              window === "24H"
                ? NotificationTemplate.BOOKING_REMINDER_24H
                : NotificationTemplate.BOOKING_REMINDER_1H,
            to: appt.email!,
            subject,
            html,
            studioId: appt.studioId ?? null,
            entityType: "Appointment",
            entityId: `${appt.id}:${window}`,
          });
          sent++;
        } catch (error) {
          errors.push(
            `${appt.id}: ${error instanceof Error ? error.message : "unknown"}`,
          );
        }
      }

      return { window, scanned: candidates.length, sent, skipped, errors };
    });
  }

  public async takenSlots(date: string) {
    const appointments = await this.appointment.findMany({
      where: {
        appointmentDate: new Date(`${date}T00:00:00.000Z`),
        status: { not: "CANCELLED" },
      },
      select: { appointmentTime: true },
    });
    const taken = [...new Set(appointments.map((a) => a.appointmentTime))];
    return { message: "Availability retrieved successfully", data: taken };
  }

  public async listForUser(userId: string, page: CursorPage) {
    const appointments = await this.appointment.findMany({
      where: { userId },
      orderBy: [{ appointmentDate: "desc" }, { id: "desc" }],
      include: serviceInclude,
      ...cursorPageArgs(page),
    });
    appointments.forEach((item) => { item.designImageUrl = this.s3.deliveryUrl(item.designImageUrl); });
    return { message: "Appointments retrieved successfully", ...cursorPageResult(appointments, page) };
  }

  public async listAll(page: CursorPage) {
    const appointments = await this.appointment.findMany({
      orderBy: [{ appointmentDate: "desc" }, { id: "desc" }],
      include: serviceInclude,
      ...cursorPageArgs(page),
    });
    appointments.forEach((item) => { item.designImageUrl = this.s3.deliveryUrl(item.designImageUrl); });
    return { message: "Appointments retrieved successfully", ...cursorPageResult(appointments, page) };
  }

  /**
   * Move an appointment to a new slot (studio admin).
   *
   * Cancelled and completed bookings are not movable — rescheduling either
   * would silently resurrect a finished booking. The previous slot is kept on
   * the row so the customer's email can show what changed and the studio has a
   * trail.
   */
  public async reschedule(
    id: string,
    input: { date?: unknown; time?: unknown; reason?: unknown },
  ) {
    const existing = await this.appointment.findUnique({
      where: { id },
      include: serviceInclude,
    });
    if (!existing) throw new ApiError("Appointment not found", 404);
    if (existing.status === "CANCELLED" || existing.status === "COMPLETED") {
      throw new ApiError(
        `A ${existing.status.toLowerCase()} appointment can't be rescheduled`,
        400,
      );
    }

    const dateRaw = String(input.date ?? "").trim();
    const time = String(input.time ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
      throw new ApiError("A new date is required (YYYY-MM-DD)", 400);
    }
    if (!/^\d{2}:\d{2}$/.test(time)) {
      throw new ApiError("A new time is required (HH:MM)", 400);
    }
    const date = new Date(`${dateRaw}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
      throw new ApiError("That date isn't valid", 400);
    }

    const reason =
      typeof input.reason === "string" && input.reason.trim()
        ? input.reason.trim().slice(0, 300)
        : null;

    const sameSlot =
      existing.appointmentDate.getTime() === date.getTime() &&
      existing.appointmentTime === time;
    if (sameSlot) {
      throw new ApiError("That's already the appointment's slot", 400);
    }

    // Don't move it on top of another live booking.
    const clash = await this.appointment.findFirst({
      where: {
        appointmentDate: date,
        appointmentTime: time,
        status: { not: "CANCELLED" },
        id: { not: id },
      },
      select: { id: true },
    });
    if (clash) {
      throw new ApiError("That slot is already taken", 409);
    }

    const appointment = await this.appointment.update({
      where: { id },
      data: {
        appointmentDate: date,
        appointmentTime: time,
        rescheduledFromDate: existing.appointmentDate,
        rescheduledFromTime: existing.appointmentTime,
        rescheduledAt: new Date(),
      },
      include: serviceInclude,
    });

    if (appointment.email) {
      try {
        const studio = await this.currentStudioBranding();
        const brand: EmailBrand = studio
          ? { kind: "studio", studio }
          : { kind: "zuri", zuri: { name: "Zuri Studios", websiteUrl: "https://zuristudios.com", supportEmail: "hello@zuristudios.com" } };
        const { subject, html } = bookingRescheduled(brand, {
          serviceName: appointment.service?.name ?? "your service",
          date: formatDate(appointment.appointmentDate),
          time: appointment.appointmentTime,
          duration: appointment.service?.duration ?? null,
          studioName: studio?.name ?? "the studio",
          bookingRef: shortRef("APT", appointment.id),
          customerFirstName:
            appointment.fullName.split(" ")[0] || appointment.fullName,
          previousDate: formatDate(existing.appointmentDate),
          previousTime: existing.appointmentTime,
          reason,
          ...(studio?.bookingUrl ? { bookingUrl: studio.bookingUrl } : {}),
        });
        await this.notifications.send({
          template: NotificationTemplate.BOOKING_RESCHEDULED,
          to: appointment.email,
          subject,
          html,
          studioId: getTenantContext()?.studioId ?? null,
          entityType: "Appointment",
          // Keyed by the new slot: an appointment can legitimately be moved
          // more than once, and each move is its own event to notify about.
          entityId: `${appointment.id}:${dateRaw}T${time}`,
        });
      } catch (error) {
        console.error("Failed to send reschedule notification:", error);
      }
    }

    return { message: "Appointment rescheduled", data: appointment };
  }

  public async updateStatus(id: string, status: AppointmentStatusInput) {
    const existing = await this.appointment.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError("Appointment not found", 404);
    }
    const appointment = await this.appointment.update({
      where: { id },
      data: { status },
      include: serviceInclude,
    });

    // Award loyalty points the first time an appointment is completed — on the
    // amount actually paid (after any loyalty discount), never the sticker price.
    let pointsEarned = 0;
    if (status === "COMPLETED" && appointment.userId) {
      const netPaid =
        (appointment.totalPrice ?? 0) - (appointment.discountAmount ?? 0);
      pointsEarned = await this.awardLoyaltyForCompletion(
        appointment.id,
        appointment.userId,
        netPaid,
        appointment.service?.name ?? "service",
      );
    }

    // Refund redeemed points if the booking is cancelled (once).
    if (
      status === "CANCELLED" &&
      appointment.userId &&
      appointment.pointsRedeemed > 0 &&
      !appointment.pointsRefunded
    ) {
      await this.loyaltyPoints.upsert({
        where: { userId: appointment.userId },
        update: { points: { increment: appointment.pointsRedeemed } },
        create: {
          userId: appointment.userId,
          points: appointment.pointsRedeemed,
          lifetimePoints: 0,
        },
      });
      await this.loyaltyTransaction.create({
        data: {
          userId: appointment.userId,
          points: appointment.pointsRedeemed,
          type: "REFUND",
          description: "Points refunded (appointment cancelled)",
          appointmentId: appointment.id,
        },
      });
      await this.appointment.update({
        where: { id: appointment.id },
        data: { pointsRefunded: true },
      });
      appointment.pointsRefunded = true;
    }

    // Status-change notifications (best-effort — never block the transition).
    if (
      (status === "COMPLETED" || status === "CANCELLED" || status === "CONFIRMED") &&
      appointment.email
    ) {
      try {
        const studio = await this.currentStudioBranding();
        const brand: EmailBrand = studio
          ? { kind: "studio", studio }
          : { kind: "zuri", zuri: { name: "Zuri Studios", websiteUrl: "https://zuristudios.com", supportEmail: "hello@zuristudios.com" } };
        const core = {
          serviceName: appointment.service?.name ?? "your service",
          date: formatDate(appointment.appointmentDate),
          time: appointment.appointmentTime,
          duration: appointment.service?.duration ?? null,
          studioName: studio?.name ?? "the studio",
          bookingRef: shortRef("APT", appointment.id),
        };
        const customerFirstName = appointment.fullName.split(" ")[0] || appointment.fullName;

        if (status === "CONFIRMED") {
          // Money state is read from the payment row, not assumed from the
          // fact that the studio approved the booking.
          const payment = await this.payment.findUnique({
            where: { appointmentId: appointment.id },
            select: { amount: true, totalAmount: true, status: true },
          });
          const amountDue =
            (appointment.totalPrice ?? 0) - (appointment.discountAmount ?? 0);
          const view = paymentView(payment, amountDue);
          const { subject, html } = bookingConfirmed(brand, {
            ...core,
            customerFirstName,
            paymentStatusLabel: view.label,
            ...(view.lines.length ? { paymentLines: view.lines } : {}),
            ...(view.balanceDue ? { balanceDue: view.balanceDue } : {}),
            ...(studio?.bookingUrl ? { bookingUrl: studio.bookingUrl } : {}),
          });
          await this.notifications.send({
            template: NotificationTemplate.BOOKING_CONFIRMED,
            to: appointment.email,
            subject,
            html,
            studioId: getTenantContext()?.studioId ?? null,
            entityType: "Appointment",
            entityId: appointment.id,
          });
        } else if (status === "COMPLETED") {
          const { subject, html } = bookingCompleted(brand, {
            ...core,
            customerFirstName,
            ...(pointsEarned > 0 ? { loyaltyPointsEarned: pointsEarned } : {}),
          });
          await this.notifications.send({
            template: NotificationTemplate.BOOKING_COMPLETED,
            to: appointment.email,
            subject,
            html,
            studioId: getTenantContext()?.studioId ?? null,
            entityType: "Appointment",
            entityId: appointment.id,
          });
        } else {
          const { subject, html } = bookingCancelled(brand, {
            ...core,
            customerFirstName,
            ...(studio?.bookingUrl ? { bookingUrl: studio.bookingUrl } : {}),
          });
          await this.notifications.send({
            template: NotificationTemplate.BOOKING_CANCELLED,
            to: appointment.email,
            subject,
            html,
            studioId: getTenantContext()?.studioId ?? null,
            entityType: "Appointment",
            entityId: appointment.id,
          });
        }
      } catch (error) {
        console.error("Failed to send booking status notification:", error);
      }
    }

    return { message: "Appointment status updated", data: appointment };
  }

  // 1 point earned per GHS 10 spent. Idempotent per appointment.
  private static readonly GHS_PER_POINT = 10;
  private static readonly REFERRAL_BONUS = 100;

  private async awardLoyaltyForCompletion(
    appointmentId: string,
    userId: string,
    totalPrice: number,
    serviceName: string,
  ): Promise<number> {
    // Guard against double-awarding if the status is set to COMPLETED again.
    const alreadyEarned = await this.loyaltyTransaction.findFirst({
      where: { appointmentId, type: "EARNED" },
    });
    if (alreadyEarned) return 0;

    const points = Math.floor(totalPrice / AppointmentService.GHS_PER_POINT);
    if (points <= 0) return 0;

    await this.loyaltyTransaction.create({
      data: {
        userId,
        points,
        type: "EARNED",
        description: `Earned for ${serviceName}`,
        appointmentId,
      },
    });

    await this.loyaltyPoints.upsert({
      where: { userId },
      update: {
        points: { increment: points },
        lifetimePoints: { increment: points },
      },
      create: { userId, points, lifetimePoints: points },
    });

    await this.awardReferralBonusIfEligible(userId);
    return points;
  }

  // When a referred user completes their first appointment, reward the referrer.
  private async awardReferralBonusIfEligible(referredUserId: string) {
    const referral = await this.referral.findFirst({
      where: { referredId: referredUserId, rewarded: false },
    });
    if (!referral) return;

    const bonus = AppointmentService.REFERRAL_BONUS;

    await this.loyaltyTransaction.create({
      data: {
        userId: referral.referrerId,
        points: bonus,
        type: "REFERRAL_BONUS",
        description: "Referral bonus — a friend you referred completed a visit",
      },
    });

    await this.loyaltyPoints.upsert({
      where: { userId: referral.referrerId },
      update: {
        points: { increment: bonus },
        lifetimePoints: { increment: bonus },
      },
      create: { userId: referral.referrerId, points: bonus, lifetimePoints: bonus },
    });

    await this.referral.update({
      where: { id: referral.id },
      data: { rewarded: true },
    });
  }

  public async remove(id: string) {
    const existing = await this.appointment.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError("Appointment not found", 404);
    }
    await this.appointment.delete({ where: { id } });
    return { message: "Appointment deleted successfully" };
  }
}
