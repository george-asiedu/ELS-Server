import { Connection } from "../db/dbConnection";
import { getTenantContext } from "../tenant/context";
import { ApiError } from "../middleware/apiError";
import { S3BucketService } from "../bucket/s3BucketService";
import { UploadedFile } from "../models/user";
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
} from "../notifications/templates/booking";
import { EmailBrand } from "../notifications/types";

// A short, human-friendly reference derived from the real record id (not a
// separately-tracked field) — e.g. "APT-4F9C2A1B".
const shortRef = (prefix: string, id: string) =>
  `${prefix}-${id.slice(-8).toUpperCase()}`;

const formatDate = (d: Date) =>
  d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric" });

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
      amount: true,
      totalAmount: true,
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
    designImage?: UploadedFile,
  ) {
    const service = await this.service.findUnique({
      where: { id: data.serviceId },
    });
    if (!service) {
      throw new ApiError("Selected service not found", 404);
    }

    let designImageUrl: string | undefined;
    if (designImage) {
      designImageUrl = await this.s3.uploadFile(designImage);
    }

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

  public async listForUser(userId: string) {
    const appointments = await this.appointment.findMany({
      where: { userId },
      orderBy: { appointmentDate: "desc" },
      include: serviceInclude,
    });
    return { message: "Appointments retrieved successfully", data: appointments };
  }

  public async listAll() {
    const appointments = await this.appointment.findMany({
      orderBy: { appointmentDate: "desc" },
      include: serviceInclude,
    });
    return { message: "Appointments retrieved successfully", data: appointments };
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
    if ((status === "COMPLETED" || status === "CANCELLED") && appointment.email) {
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

        if (status === "COMPLETED") {
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
