import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import { S3BucketService } from "../bucket/s3BucketService";
import { EmailService } from "../email/emailService";
import { UploadedFile } from "../models/user";
import {
  AppointmentStatusInput,
  CreateAppointmentInput,
} from "./appointmentModels";

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
} as const;

export class AppointmentService extends Connection {
  private s3 = new S3BucketService();
  private email = new EmailService();

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

    const appointment = await this.appointment.create({
      data: {
        fullName: data.fullName,
        phone: data.phone,
        email: data.email ?? null,
        appointmentDate: new Date(`${data.appointmentDate}T00:00:00.000Z`),
        appointmentTime: data.appointmentTime,
        notes: data.notes ?? null,
        totalPrice: service.price,
        serviceId: data.serviceId,
        ...(designImageUrl ? { designImageUrl } : {}),
        ...(userId ? { userId } : {}),
      },
      include: serviceInclude,
    });

    // Automated confirmation email (best-effort — never block the booking).
    if (appointment.email) {
      try {
        await this.email.sendAppointmentReceived(appointment.email, {
          fullName: appointment.fullName,
          serviceName: appointment.service?.name ?? "your service",
          date: data.appointmentDate,
          time: appointment.appointmentTime,
        });
      } catch (error) {
        console.error("Failed to send appointment confirmation email:", error);
      }
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

    // Award loyalty points the first time an appointment is completed.
    if (status === "COMPLETED" && appointment.userId) {
      await this.awardLoyaltyForCompletion(
        appointment.id,
        appointment.userId,
        appointment.totalPrice ?? 0,
        appointment.service?.name ?? "service",
      );
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
  ) {
    // Guard against double-awarding if the status is set to COMPLETED again.
    const alreadyEarned = await this.loyaltyTransaction.findFirst({
      where: { appointmentId, type: "EARNED" },
    });
    if (alreadyEarned) return;

    const points = Math.floor(totalPrice / AppointmentService.GHS_PER_POINT);
    if (points <= 0) return;

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
