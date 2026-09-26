import { Connection } from "../db/dbConnection";
import { CursorPage, cursorPageArgs, cursorPageResult } from "../utils/cursorPagination";
import { getTenantContext, runAsSuperAdmin } from "../tenant/context";
import { ApiError } from "../middleware/apiError";
import { parseDurationMinutes } from "./duration";
import { AuditService } from "../audit/auditService";
import { LedgerService } from "../ledger/ledgerService";
import { RefundService } from "../refund/refundService";
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
  bookingRescheduleRequested,
  bookingServiceChanged,
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

/**
 * Everything that makes a slot bookable, in one place.
 *
 * This is deliberately shared by create() and reschedule(): before it existed,
 * the server validated only that the date matched yyyy-MM-dd and the time was a
 * non-empty string. Business hours, blocked dates, past dates and — most
 * importantly — double-booking were enforced nowhere, because the booking UI
 * filtered slots client-side using /availability. Two customers racing for the
 * same slot both succeeded, and the studio found out when they both arrived.
 *
 * Slots are matched EXACTLY (same date + same "HH:MM" string), which mirrors how
 * /availability reports taken slots. It does not yet reason about service
 * duration, so a 4-hour service starting at 10:00 does not block 11:00 — see
 * the note in the README; that needs the slot grid to become duration-aware on
 * both sides at once.
 */
export interface SlotCheck {
  date: Date;
  time: string;
  // Excluded from the clash check — the booking being moved must not collide
  // with itself.
  ignoreAppointmentId?: string | undefined;
  // Studio admins may deliberately book outside opening hours (a private
  // after-hours appointment), so those two rules apply to customers only.
  enforceOpeningHours: boolean;
  // Minimum notice, in hours. 0 for admins.
  minNoticeHours: number;
  // How long the booking runs. When known, the slot is checked for OVERLAP
  // against other bookings' durations rather than an exact time match, and the
  // booking must also finish before the studio closes. Null (unparseable
  // duration) falls back to exact-slot matching.
  durationMinutes?: number | null;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "HH:MM" -> minutes since midnight, or null when unparseable. */
const minutesOfDay = (time: string): number | null => {
  const m = HHMM.exec(time.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
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
  private audit = new AuditService();
  private ledger = new LedgerService();
  private refunds = new RefundService();

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

    // Same gate a reschedule passes through. Until this existed the server
    // accepted any well-formatted date/time, including one in the past, on a
    // closed day, or already taken by someone else.
    await this.assertSlotBookable({
      date: new Date(`${data.appointmentDate}T00:00:00.000Z`),
      time: data.appointmentTime,
      enforceOpeningHours: true,
      // Booking for "in a few minutes" is legitimate (a walk-in the studio
      // enters), so creation has no notice floor beyond not being in the past.
      minNoticeHours: 0,
      durationMinutes: parseDurationMinutes(service.duration),
    });

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
      const brand: EmailBrand =
				studio ?
					{ kind: 'studio', studio }
				:	{
						kind: 'zuri',
						zuri: {
							name: 'Zuri Studios',
							websiteUrl: 'https://zuristudios.com',
							supportEmail: 'customersupport@zuristudios.com',
						},
					};
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
            : { kind: "zuri", zuri: { name: "Zuri Studios", websiteUrl: "https://zuristudios.com", supportEmail: "customersupport@zuristudios.com" } };

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

  /**
   * What is already booked on a date.
   *
   * `data` stays a list of exact start times (unchanged, so existing callers
   * keep working). `busy` adds each booking's start and length, which is what
   * a caller needs to grey out a slot that merely OVERLAPS an existing
   * booking — without it the UI would offer an 11:00 slot that the server
   * rejects because a 4-hour service started at 10:00.
   */
  public async takenSlots(date: string) {
    const appointments = await this.appointment.findMany({
      where: {
        appointmentDate: new Date(`${date}T00:00:00.000Z`),
        status: { not: "CANCELLED" },
      },
      select: {
        appointmentTime: true,
        service: { select: { duration: true } },
      },
    });
    const taken = [...new Set(appointments.map((a) => a.appointmentTime))];
    const busy = appointments
      .map((a) => ({
        start: a.appointmentTime,
        minutes: parseDurationMinutes(a.service?.duration) ?? 0,
      }))
      .filter((b) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(b.start));
    return {
      message: "Availability retrieved successfully",
      data: taken,
      busy,
    };
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
   * The single gate every booking and every move passes through. Throws an
   * ApiError describing the first rule broken; returns the resolved instant.
   */
  public async assertSlotBookable(check: SlotCheck): Promise<Date> {
    const mins = minutesOfDay(check.time);
    if (mins === null) {
      throw new ApiError("Pick a time in 24-hour HH:MM format", 400);
    }

    // The exact instant, built from the date (midnight UTC) plus the slot time.
    const at = new Date(check.date);
    at.setUTCHours(Math.floor(mins / 60), mins % 60, 0, 0);
    if (Number.isNaN(at.getTime())) {
      throw new ApiError("That date and time aren't valid", 400);
    }

    const now = Date.now();
    if (at.getTime() <= now) {
      throw new ApiError("That time is in the past", 400);
    }
    if (check.minNoticeHours > 0) {
      const earliest = now + check.minNoticeHours * 60 * 60 * 1000;
      if (at.getTime() < earliest) {
        throw new ApiError(
          check.minNoticeHours === 1
            ? "Please choose a time at least 1 hour from now"
            : `Please choose a time at least ${check.minNoticeHours} hours from now`,
          400,
        );
      }
    }

    if (check.enforceOpeningHours) {
      // Blocked dates are whole days the studio has closed off.
      const dayStart = new Date(at);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(at);
      dayEnd.setUTCHours(23, 59, 59, 999);
      const blocked = await this.blockedDate.findFirst({
        where: { date: { gte: dayStart, lte: dayEnd } },
        select: { reason: true },
      });
      if (blocked) {
        throw new ApiError(
          blocked.reason
            ? `The studio is closed that day (${blocked.reason})`
            : "The studio is closed that day",
          400,
        );
      }

      // Opening hours for that weekday. No row configured means no restriction
      // — a studio that has never set its hours should still take bookings.
      const hours = await this.businessHours.findFirst({
        where: { dayOfWeek: at.getUTCDay() },
        select: { isClosed: true, openTime: true, closeTime: true },
      });
      if (hours?.isClosed) {
        throw new ApiError("The studio is closed on that day", 400);
      }
      const open = hours?.openTime ? minutesOfDay(hours.openTime) : null;
      const close = hours?.closeTime ? minutesOfDay(hours.closeTime) : null;
      if (open !== null && mins < open) {
        throw new ApiError(`The studio opens at ${hours!.openTime}`, 400);
      }
      // The slot must START before closing; a booking cannot begin at close.
      if (close !== null && mins >= close) {
        throw new ApiError(`The studio closes at ${hours!.closeTime}`, 400);
      }
      // ...and FINISH before closing, when we know how long it runs.
      if (close !== null && check.durationMinutes) {
        const ends = mins + check.durationMinutes;
        if (ends > close) {
          throw new ApiError(
            `That service runs past closing time (${hours!.closeTime}). Please pick an earlier slot.`,
            400,
          );
        }
      }
    }

    // Double-booking. Cancelled bookings free their slot; everything else holds
    // it, including one awaiting a reschedule decision.
    //
    // Every booking that day is loaded rather than just the matching time,
    // because a 4-hour service starting at 10:00 collides with an 11:00 slot
    // that no exact-match query would ever find.
    const sameDay = await this.appointment.findMany({
      where: {
        appointmentDate: check.date,
        status: { not: "CANCELLED" },
        ...(check.ignoreAppointmentId
          ? { id: { not: check.ignoreAppointmentId } }
          : {}),
      },
      select: {
        id: true,
        appointmentTime: true,
        service: { select: { duration: true } },
      },
    });

    const newStart = mins;
    // An unknown duration is treated as a single point in time, so it can still
    // catch an exact collision without inventing a length it might not have.
    const newEnd = newStart + (check.durationMinutes ?? 0);

    for (const other of sameDay) {
      const otherStart = minutesOfDay(other.appointmentTime);
      if (otherStart === null) continue;
      const otherEnd =
        otherStart + (parseDurationMinutes(other.service?.duration) ?? 0);

      // Half-open intervals: a booking ending at 12:00 and one starting at
      // 12:00 do not overlap. Zero-length (unknown duration) still matches an
      // identical start.
      const overlaps =
        newStart === otherStart ||
        (newStart < otherEnd && otherStart < newEnd);
      if (overlaps) {
        throw new ApiError("That slot is already taken", 409);
      }
    }

    return at;
  }

  /** How much notice this studio requires of a customer moving their booking. */
  private async rescheduleNoticeHours(): Promise<number> {
    const studioId = getTenantContext()?.studioId;
    if (!studioId) return 2;
    const settings = await this.studioSettings.findFirst({
      where: { studioId },
      select: { rescheduleNoticeHours: true },
    });
    return settings?.rescheduleNoticeHours ?? 2;
  }

  /**
   * Move an appointment to a new slot.
   *
   * Who asks changes the rules, not the mechanics:
   *  - A studio admin is authoritative. No notice period, may book outside
   *    opening hours, and the booking keeps whatever status it had.
   *  - A customer may only move their OWN booking, must give the studio's
   *    required notice, must land inside opening hours, and the booking drops
   *    to PENDING_RESCHEDULE until the studio approves it.
   *
   * Either way the payment stays attached to the appointment, so a deposit
   * follows the booking to its new time — nothing is re-charged or released.
   */
  public async reschedule(
    id: string,
    input: { date?: unknown; time?: unknown; reason?: unknown },
    actor: { role: "ADMIN" | "CUSTOMER"; userId?: string } = { role: "ADMIN" },
  ) {
    const existing = await this.appointment.findUnique({
      where: { id },
      include: serviceInclude,
    });
    if (!existing) throw new ApiError("Appointment not found", 404);

    const byCustomer = actor.role === "CUSTOMER";
    if (byCustomer) {
      // Not "not found" — the caller knows the booking exists; hiding that
      // would just be confusing. Ownership is the actual objection.
      if (!actor.userId || existing.userId !== actor.userId) {
        throw new ApiError("You can only reschedule your own booking", 403);
      }
    }
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
    const date = new Date(`${dateRaw}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
      throw new ApiError("That date isn't valid", 400);
    }

    const reason =
      typeof input.reason === "string" && input.reason.trim()
        ? input.reason.trim().slice(0, 300)
        : null;

    if (
      existing.appointmentDate.getTime() === date.getTime() &&
      existing.appointmentTime === time
    ) {
      throw new ApiError("That's already the appointment's slot", 400);
    }

    await this.assertSlotBookable({
      date,
      time,
      ignoreAppointmentId: id,
      enforceOpeningHours: byCustomer,
      minNoticeHours: byCustomer ? await this.rescheduleNoticeHours() : 0,
      durationMinutes: parseDurationMinutes(existing.service?.duration),
    });

    const appointment = await this.appointment.update({
      where: { id },
      data: {
        appointmentDate: date,
        appointmentTime: time,
        rescheduledFromDate: existing.appointmentDate,
        rescheduledFromTime: existing.appointmentTime,
        rescheduledAt: new Date(),
        // A customer-initiated move holds the new slot but needs the studio to
        // agree to it. An admin move is the studio agreeing, so it stands.
        ...(byCustomer ? { status: "PENDING_RESCHEDULE" as const } : {}),
      },
      include: serviceInclude,
    });

    const studio = await this.currentStudioBranding();
    const brand: EmailBrand =
			studio ?
				{ kind: 'studio', studio }
			:	{
					kind: 'zuri',
					zuri: {
						name: 'Zuri Studios',
						websiteUrl: 'https://zuristudios.com',
						supportEmail: 'customersupport@zuristudios.com',
					},
				};
    const core = {
      serviceName: appointment.service?.name ?? "your service",
      date: formatDate(appointment.appointmentDate),
      time: appointment.appointmentTime,
      duration: appointment.service?.duration ?? null,
      studioName: studio?.name ?? "the studio",
      bookingRef: shortRef("APT", appointment.id),
    };

    if (byCustomer) {
      // Tell the STUDIO — they are the ones who have to accept or decline it.
      try {
        const to = await this.currentStudioNotifyEmail();
        if (to) {
          const { subject, html } = bookingRescheduleRequested(brand, {
            ...core,
            customerName: appointment.fullName,
            previousDate: formatDate(existing.appointmentDate),
            previousTime: existing.appointmentTime,
            reason,
            ...(studio?.bookingUrl ? { reviewUrl: studio.bookingUrl } : {}),
          });
          await this.notifications.send({
            template: NotificationTemplate.BOOKING_RESCHEDULE_REQUESTED,
            to,
            subject,
            html,
            studioId: getTenantContext()?.studioId ?? null,
            entityType: "Appointment",
            entityId: `${appointment.id}:${dateRaw}T${time}`,
          });
        }
      } catch (error) {
        console.error("Failed to notify studio of reschedule request:", error);
      }
    } else if (appointment.email) {
      // Studio moved it — tell the customer, and it's already settled.
      try {
        const { subject, html } = bookingRescheduled(brand, {
          ...core,
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
          // Keyed by the new slot: a booking can legitimately move more than
          // once, and each move is its own event.
          entityId: `${appointment.id}:${dateRaw}T${time}`,
        });
      } catch (error) {
        console.error("Failed to send reschedule notification:", error);
      }
    }

    return {
      message: byCustomer
        ? "Reschedule requested — the studio will confirm your new time."
        : "Appointment rescheduled",
      data: appointment,
    };
  }

  /**
   * Change the service on an existing booking.
   *
   * Modelled as cancel-and-rebook under one booking reference rather than an
   * in-place edit: the booking keeps its id and history, and the money moves as
   * its own explicit event — a refund when the new service costs less than has
   * been paid, or a larger balance due when it costs more. Nothing is silently
   * re-priced, and the ledger carries an ADJUSTMENT row either way.
   *
   * Admin-only for now. A customer-initiated version needs somewhere to park a
   * REQUESTED service while the studio decides, because the money must not move
   * before approval — see the note in the README.
   */
  public async changeService(
    id: string,
    newServiceId: string,
    actor: { email?: string; role?: string } = {},
  ) {
    const existing = await this.appointment.findUnique({
      where: { id },
      include: serviceInclude,
    });
    if (!existing) throw new ApiError("Appointment not found", 404);
    if (existing.status === "CANCELLED" || existing.status === "COMPLETED") {
      throw new ApiError(
        `A ${existing.status.toLowerCase()} appointment can't be changed`,
        400,
      );
    }
    if (existing.serviceId === newServiceId) {
      throw new ApiError("That's already the booked service", 400);
    }

    const next = await this.service.findUnique({ where: { id: newServiceId } });
    if (!next) throw new ApiError("Selected service not found", 404);
    if (!next.active) {
      throw new ApiError("That service isn't currently offered", 400);
    }

    // The new service may run longer, so the slot has to be re-checked against
    // its duration — this is the case that made duration-awareness a
    // prerequisite rather than a nicety.
    await this.assertSlotBookable({
      date: existing.appointmentDate,
      time: existing.appointmentTime,
      ignoreAppointmentId: id,
      enforceOpeningHours: true,
      minNoticeHours: 0,
      durationMinutes: parseDurationMinutes(next.duration),
    });

    const round = (n: number) => Math.round(n * 100) / 100;
    // Promo price wins when it undercuts the list price, same as booking.
    const newPrice =
      next.promoPrice !== null && next.promoPrice < next.price
        ? next.promoPrice
        : next.price;

    // A loyalty discount was sized against the old price; it must not exceed
    // the new one, or a cheaper service could end up owing the customer money
    // it never collected.
    const discount = Math.min(existing.discountAmount ?? 0, newPrice);
    const newDue = round(newPrice - discount);

    const payment = await this.payment.findUnique({
      where: { appointmentId: id },
    });
    const settled =
      payment &&
      ["PAID", "PARTIALLY_REFUNDED"].includes(payment.status) &&
      payment.amount > 0;
    const netPaid = settled
      ? round(payment.amount - (payment.refundedAmount ?? 0))
      : 0;

    const appointment = await this.appointment.update({
      where: { id },
      data: {
        serviceId: newServiceId,
        totalPrice: newPrice,
        discountAmount: discount,
      },
      include: serviceInclude,
    });

    // Keep the payment's "full amount due" in step, so the balance a customer
    // still owes is computed from the new price everywhere it is shown.
    if (payment) {
      await this.payment.update({
        where: { id: payment.id },
        data: { totalAmount: newDue },
      });
    }

    let refunded = 0;
    let balanceDue = round(Math.max(0, newDue - netPaid));

    // Overpaid because the new service is cheaper — give the difference back
    // through the ordinary refund path so it is recorded and receipted like
    // any other refund.
    if (settled && netPaid > newDue) {
      const over = round(netPaid - newDue);
      try {
        await this.refunds.refundPayment(payment!.id, actor, {
          amount: over,
          reason: `Service changed from ${existing.service?.name ?? "previous service"} to ${next.name}`,
        });
        refunded = over;
        balanceDue = 0;
      } catch (error) {
        // A provider failure must not undo the service change the studio just
        // made — the change stands and the refund is surfaced to be retried.
        console.error("Service-change refund failed:", error);
        throw new ApiError(
          `The service was changed, but the ${ghs(over)} refund could not be started: ${
            error instanceof Error ? error.message : "provider error"
          }. Please issue it from Transactions.`,
          502,
        );
      }
    }

    await this.audit.record({
      actor,
      action: "appointment.service_changed",
      targetType: "Appointment",
      targetId: id,
      studioId: existing.studioId ?? undefined,
      metadata: {
        from: { id: existing.serviceId, name: existing.service?.name ?? null, price: existing.totalPrice },
        to: { id: next.id, name: next.name, price: newPrice },
        netPaid,
        newDue,
        refunded,
        balanceDue,
      },
    });

    // A price move with no cash movement still belongs on the ledger — it
    // changes what the studio is owed.
    if (round(newPrice) !== round(existing.totalPrice ?? 0)) {
      const delta = round(newPrice - (existing.totalPrice ?? 0));
      await this.ledger.post({
        studioId: existing.studioId,
        type: "ADJUSTMENT",
        direction: delta >= 0 ? "CREDIT" : "DEBIT",
        status: "SUCCESS",
        amount: Math.abs(delta),
        dedupeKey: `appointment:service-change:${id}:${Date.now()}`,
        description: `Service changed: ${existing.service?.name ?? "previous"} → ${next.name}`,
        customerName: existing.fullName,
        customerEmail: existing.email,
        appointmentId: id,
        paymentId: payment?.id ?? null,
        actorEmail: actor.email ?? null,
        actorRole: actor.role ?? "studio",
      });
    }

    if (appointment.email) {
      try {
        const studio = await this.currentStudioBranding();
        const brand: EmailBrand = studio
          ? { kind: "studio", studio }
          : { kind: "zuri", zuri: { name: "Zuri Studios", websiteUrl: "https://zuristudios.com", supportEmail: "hello@zuristudios.com" } };
        const { subject, html } = bookingServiceChanged(brand, {
          serviceName: next.name,
          date: formatDate(appointment.appointmentDate),
          time: appointment.appointmentTime,
          duration: next.duration,
          studioName: studio?.name ?? "the studio",
          bookingRef: shortRef("APT", appointment.id),
          customerFirstName:
            appointment.fullName.split(" ")[0] || appointment.fullName,
          previousServiceName: existing.service?.name ?? "your previous service",
          lines: [
            { label: "New total", value: ghs(newDue) },
            ...(netPaid > 0 ? [{ label: "Already paid", value: ghs(netPaid) }] : []),
            ...(refunded > 0
              ? [{ label: "Refunded to you", value: ghs(refunded), emphasis: true }]
              : []),
            ...(balanceDue > 0
              ? [{ label: "Balance due", value: ghs(balanceDue), emphasis: true }]
              : []),
          ],
          refunded: refunded > 0 ? ghs(refunded) : null,
          balanceDue: balanceDue > 0 ? ghs(balanceDue) : null,
          ...(studio?.bookingUrl ? { bookingUrl: studio.bookingUrl } : {}),
        });
        await this.notifications.send({
          template: NotificationTemplate.BOOKING_SERVICE_CHANGED,
          to: appointment.email,
          subject,
          html,
          studioId: getTenantContext()?.studioId ?? null,
          entityType: "Appointment",
          entityId: `${id}:service:${newServiceId}`,
        });
      } catch (error) {
        console.error("Failed to send service-change notification:", error);
      }
    }

    return {
      message:
        refunded > 0
          ? `Service changed. ${ghs(refunded)} is being refunded.`
          : balanceDue > 0
            ? `Service changed. ${ghs(balanceDue)} is now due.`
            : "Service changed.",
      data: { appointment, newDue, netPaid, refunded, balanceDue },
    };
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
      (status === "COMPLETED" ||
        status === "CANCELLED" ||
        status === "CONFIRMED") &&
      appointment.email
    ) {
      try {
        const studio = await this.currentStudioBranding();
        const brand: EmailBrand = studio
          ? { kind: "studio", studio }
          : { kind: "zuri", zuri: { name: "Zuri Studios", websiteUrl: "https://zuristudios.com", supportEmail: "customersupport@zuristudios.com" } };
        const core = {
          serviceName: appointment.service?.name ?? "your service",
          date: formatDate(appointment.appointmentDate),
          time: appointment.appointmentTime,
          duration: appointment.service?.duration ?? null,
          studioName: studio?.name ?? "the studio",
          bookingRef: shortRef("APT", appointment.id),
        };
        const customerFirstName = appointment.fullName.split(" ")[0] || appointment.fullName;

        if (status === "CONFIRMED" && existing.status === "PENDING_RESCHEDULE") {
          // Approving a customer's reschedule. The right email is the one that
          // shows what moved, not a generic "you're confirmed" — the customer
          // already knew they were confirmed; what they're waiting on is
          // whether the studio accepted the new time.
          const { subject, html } = bookingRescheduled(brand, {
            ...core,
            customerFirstName,
            previousDate: appointment.rescheduledFromDate
              ? formatDate(appointment.rescheduledFromDate)
              : core.date,
            previousTime: appointment.rescheduledFromTime ?? core.time,
            reason: null,
            ...(studio?.bookingUrl ? { bookingUrl: studio.bookingUrl } : {}),
          });
          await this.notifications.send({
            template: NotificationTemplate.BOOKING_RESCHEDULED,
            to: appointment.email,
            subject,
            html,
            studioId: getTenantContext()?.studioId ?? null,
            entityType: "Appointment",
            entityId: `${appointment.id}:approved:${appointment.appointmentTime}`,
          });
        } else if (status === "CONFIRMED") {
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
