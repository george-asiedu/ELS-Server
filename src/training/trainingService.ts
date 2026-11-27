import { ApiError } from "../middleware/apiError";
import { createTenantClient } from "../tenant/tenantClient";
import { addExtraCharge, waiveExtraCharge } from "../billing/extraCharges";
import { notifyStudioAdmins, notifyUsers } from "../push/pushService";
import { NotificationService } from "../notifications/notificationService";
import {
  trainingSpotConfirmed,
  trainingSpotReservedPlatform,
} from "../notifications/templates/trainingSession";
import {
  buildIcs,
  googleCalendarUrl,
  whenText,
  type SessionEvent,
} from "./calendar";
import { alertPlatform } from "../notifications/platformAlert";
import { NotificationTemplate } from "../notifications/registry";
import { platformBrand } from "../notifications/brand";
import { trainingRequestSubmitted } from "../notifications/templates/trainingRequest";
import { env } from "../config/env.config";

// Training. Online training (the guides in the dashboard and a free live
// session) costs nothing and needs no request. In-person training is a request:
// the super admin sets the fee and the date, the fee is added to the studio's
// next bill, and the studio is told at each step.

const { raw } = createTenantClient();
const notifications = new NotificationService();
const text = (v: unknown, max: number) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
const STATUSES = ["NEW", "SCHEDULED", "DONE", "DECLINED"] as const;
type Status = (typeof STATUSES)[number];

const config = async () =>
  (await raw.platformConfig.findFirst()) ??
  (await raw.platformConfig.create({ data: {} }));

/** The calendar entry for the next live session, or null when none is set. */
const sessionEvent = (
  cfg: {
    trainingLiveAt: Date | null;
    trainingLiveMinutes: number;
    trainingLiveUrl: string | null;
    trainingLiveNote: string | null;
  },
  studioId: string,
): SessionEvent | null =>
  cfg.trainingLiveAt
    ? {
        uid: `live-training-${cfg.trainingLiveAt.toISOString()}-${studioId}@zuristudios.com`,
        title: "Zuri live training",
        start: cfg.trainingLiveAt,
        minutes: cfg.trainingLiveMinutes,
        description: `Free live online training with Zuri.${cfg.trainingLiveNote ? ` ${cfg.trainingLiveNote}` : ""}`,
        url: cfg.trainingLiveUrl,
      }
    : null;

export const trainingInfo = async (studioId: string) => {
  const cfg = await config();
  const requests = await raw.trainingRequest.findMany({
    where: { studioId },
    orderBy: { createdAt: "desc" },
  });
  const upcoming =
    cfg.trainingLiveAt && cfg.trainingLiveAt.getTime() > Date.now()
      ? cfg.trainingLiveAt
      : null;
  const reserved = upcoming
    ? Boolean(
        await raw.trainingReservation.findUnique({
          where: { studioId_sessionAt: { studioId, sessionAt: upcoming } },
          select: { id: true },
        }),
      )
    : false;
  const event = upcoming ? sessionEvent(cfg, studioId) : null;
  return {
    liveUrl: cfg.trainingLiveUrl,
    liveNote: cfg.trainingLiveNote,
    // The next session (null when none is set or it has passed).
    liveAt: upcoming,
    liveMinutes: cfg.trainingLiveMinutes,
    liveReserved: reserved,
    googleCalendarUrl: event ? googleCalendarUrl(event) : null,
    requests,
  };
};

/**
 * Reserve a spot at the next live session. The studio gets an email (with a
 * calendar file) and a push, and the Zuri team is told. Reserving twice does
 * nothing more.
 */
export const reserveLiveSpot = async (
  studioId: string,
  user: { id?: string | undefined; email?: string | undefined },
) => {
  const cfg = await config();
  const at = cfg.trainingLiveAt;
  if (!at || at.getTime() <= Date.now())
    throw new ApiError(
      "There's no live session to reserve a spot for yet",
      400,
    );
  const existing = await raw.trainingReservation.findUnique({
    where: { studioId_sessionAt: { studioId, sessionAt: at } },
  });
  if (existing) return { reservation: existing, already: true as const, at };
  const reservation = await raw.trainingReservation.create({
    data: {
      studioId,
      sessionAt: at,
      ...(user.id ? { reservedByUserId: user.id } : {}),
      ...(user.email ? { reservedByEmail: user.email } : {}),
    },
  });
  await sendSpotNotices(cfg, reservation, { moved: false });
  return { reservation, already: false as const, at };
};

export const cancelLiveSpot = async (studioId: string) => {
  const cfg = await config();
  if (!cfg.trainingLiveAt) return;
  await raw.trainingReservation.deleteMany({
    where: { studioId, sessionAt: cfg.trainingLiveAt },
  });
};

type Reservation = {
  id: string;
  studioId: string;
  reservedByUserId: string | null;
  reservedByEmail: string | null;
  sessionAt: Date;
};

/** Email + push to the studio (and, for a new spot, to the Zuri team). Never throws. */
const sendSpotNotices = async (
  cfg: Awaited<ReturnType<typeof config>>,
  r: Reservation,
  opts: { moved: boolean },
) => {
  try {
    const event = sessionEvent(cfg, r.studioId);
    if (!event) return;
    const when = whenText(event.start);
    const studio = await raw.studio.findUnique({
      where: { id: r.studioId },
      select: { name: true, slug: true },
    });
    const to =
      r.reservedByEmail ??
      (
        await raw.user.findFirst({
          where: { studioId: r.studioId, role: "ADMIN" },
          select: { email: true },
        })
      )?.email ??
      null;
    if (to) {
      const { subject, html } = trainingSpotConfirmed(platformBrand, {
        firstName: studio?.name ?? "there",
        when,
        note: cfg.trainingLiveNote,
        joinUrl: cfg.trainingLiveUrl,
        calendarUrl: googleCalendarUrl(event),
        moved: opts.moved,
      });
      await notifications.send({
        template: NotificationTemplate.TRAINING_SPOT_CONFIRMED_STUDIO,
        to,
        subject,
        html,
        studioId: r.studioId,
        entityType: "TrainingReservation",
        entityId: `${r.id}:${event.start.toISOString()}`,
        attachments: [
          {
            filename: "zuri-live-training.ics",
            content: Buffer.from(buildIcs(event), "utf8").toString("base64"),
            contentType: "text/calendar; charset=utf-8; method=PUBLISH",
          },
        ],
      });
    }
    // The push goes to the person who reserved, else every admin of the studio.
    const pushBody = opts.moved
      ? `The live training is now ${when}.`
      : `Your spot is reserved for ${when}. Add it to your calendar from the Learn page.`;
    if (r.reservedByUserId)
      await notifyUsers([r.reservedByUserId], {
        title: opts.moved ? "Live training moved" : "Spot reserved",
        body: pushBody,
        url: "/admin/learn",
      }).catch(() => 0);
    else
      await notifyStudioAdmins(
        r.studioId,
        {
          template: "TRAINING_UPDATE",
          entityId: `${r.id}:${event.start.toISOString()}`,
          entityType: "TrainingReservation",
        },
        {
          title: opts.moved ? "Live training moved" : "Spot reserved",
          body: pushBody,
          url: "/admin/learn",
        },
      ).catch(() => 0);

    if (!opts.moved) {
      const total = await raw.trainingReservation.count({
        where: { sessionAt: r.sessionAt },
      });
      const platform = trainingSpotReservedPlatform(platformBrand, {
        studioName: studio?.name ?? "A business",
        studioSlug: studio?.slug ?? r.studioId,
        byEmail: r.reservedByEmail,
        when,
        total,
        reviewUrl: `${env.clientUrl}/platform/training`,
      });
      await alertPlatform({
        template: NotificationTemplate.TRAINING_SPOT_RESERVED_PLATFORM,
        subject: platform.subject,
        html: platform.html,
        studioId: r.studioId,
        entityType: "TrainingReservation",
        entityId: r.id,
        push: {
          title: "Live training spot reserved",
          body: `${studio?.name ?? "A business"} will join on ${when}. ${total} so far.`,
          url: "/platform/training",
        },
      });
    }
  } catch (e) {
    console.warn("Live training notice failed:", (e as Error).message);
  }
};

/** Who has reserved a spot at the next live session (for the super admin). */
export const platformReservations = async () => {
  const cfg = await config();
  if (!cfg.trainingLiveAt) return [];
  const rows = await raw.trainingReservation.findMany({
    where: { sessionAt: cfg.trainingLiveAt },
    orderBy: { createdAt: "asc" },
  });
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      createdAt: r.createdAt,
      email: r.reservedByEmail,
      studio: await raw.studio.findUnique({
        where: { id: r.studioId },
        select: { id: true, name: true, slug: true },
      }),
    })),
  );
};

export const requestInPerson = async (
  studioId: string,
  userId: string | undefined,
  input: Record<string, unknown>,
) => {
  const open = await raw.trainingRequest.count({
    where: { studioId, status: { in: ["NEW", "SCHEDULED"] } },
  });
  if (open >= 2)
    throw new ApiError(
      "You already have training requests in progress. We'll be in touch.",
      400,
    );
  const created = await raw.trainingRequest.create({
    data: {
      studioId,
      ...(userId ? { requestedByUserId: userId } : {}),
      preferredDate: text(input.preferredDate, 80),
      location: text(input.location, 200),
      notes: text(input.notes, 500),
    },
  });
  const [studio, requestedBy] = await Promise.all([
    raw.studio.findUnique({
      where: { id: studioId },
      select: { name: true, slug: true },
    }),
    userId
      ? raw.user.findUnique({ where: { id: userId }, select: { email: true } })
      : null,
  ]);
  const { subject, html } = trainingRequestSubmitted(platformBrand, {
    studioName: studio?.name ?? "A business",
    studioSlug: studio?.slug ?? studioId,
    requestedByEmail: requestedBy?.email ?? null,
    preferredDate: created.preferredDate,
    location: created.location,
    notes: created.notes,
    reviewUrl: `${env.clientUrl}/platform/training`,
  });
  await alertPlatform({
    template: NotificationTemplate.TRAINING_REQUEST_SUBMITTED_PLATFORM,
    subject,
    html,
    studioId,
    entityType: "TrainingRequest",
    entityId: created.id,
    push: {
      title: "In-person training request",
      body: `${studio?.name ?? "A business"} asked for in-person training.`,
      url: "/platform/training",
    },
  });
  return created;
};

export const platformList = async () => {
  const rows = await raw.trainingRequest.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return Promise.all(
    rows.map(async (r) => ({
      ...r,
      studio: await raw.studio.findUnique({
        where: { id: r.studioId },
        select: { id: true, name: true, slug: true },
      }),
    })),
  );
};

/** Set the fee, the date or the status. The studio is told, and the fee goes on its next bill. */
export const platformUpdate = async (
  id: string,
  input: Record<string, unknown>,
) => {
  const existing = await raw.trainingRequest.findUnique({ where: { id } });
  if (!existing) throw new ApiError("Request not found", 404);
  const data: {
    status?: Status;
    feeAmount?: number;
    scheduledFor?: Date | null;
  } = {};
  if (input.status !== undefined) {
    if (!STATUSES.includes(input.status as Status))
      throw new ApiError("Invalid status", 400);
    data.status = input.status as Status;
  }
  if (input.feeAmount !== undefined) {
    const fee = Math.round(Number(input.feeAmount) * 100) / 100;
    if (!Number.isFinite(fee) || fee < 0 || fee > 100000)
      throw new ApiError("Enter a fee between 0 and 100,000", 400);
    data.feeAmount = fee;
  }
  if (input.scheduledFor !== undefined) {
    const d = input.scheduledFor ? new Date(String(input.scheduledFor)) : null;
    if (d && Number.isNaN(d.getTime()))
      throw new ApiError("That date isn't valid", 400);
    data.scheduledFor = d;
  }
  const updated = await raw.trainingRequest.update({ where: { id }, data });

  const when = updated.scheduledFor
    ? updated.scheduledFor.toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "UTC",
      })
    : null;
  if (data.feeAmount !== undefined || data.status === "DECLINED") {
    if (data.status === "DECLINED")
      await waiveExtraCharge(existing.studioId, "TRAINING", id);
    else
      await addExtraCharge({
        studioId: existing.studioId,
        kind: "TRAINING",
        refId: id,
        description: `In-person training${when ? ` (${when})` : ""}`,
        amount: updated.feeAmount ?? 0,
      });
  }
  const parts: string[] = [];
  if (data.status === "DECLINED") parts.push("We can't do this one right now.");
  else {
    if (data.scheduledFor) parts.push(`Your training is set for ${when}.`);
    if (data.feeAmount !== undefined)
      parts.push(
        data.feeAmount > 0
          ? `The fee is GHS ${data.feeAmount.toFixed(2)}, added to your next renewal.`
          : "There's no fee for it.",
      );
    if (data.status === "DONE") parts.push("Thanks for training with us.");
  }
  if (parts.length)
    await notifyStudioAdmins(
      existing.studioId,
      {
        template: "TRAINING_UPDATE",
        entityId: `${id}:${updated.status}:${updated.feeAmount ?? ""}:${updated.scheduledFor?.toISOString() ?? ""}`,
        entityType: "TrainingRequest",
      },
      {
        title: "About your in-person training",
        body: parts.join(" "),
        url: "/admin/learn",
      },
    ).catch(() => 0);
  return updated;
};

export const saveSettings = async (input: Record<string, unknown>) => {
  const cfg = await config();
  const url = text(input.liveUrl, 300);
  if (url && !/^https:\/\//i.test(url))
    throw new ApiError("The join link should start with https://", 400);
  const data: {
    trainingLiveUrl: string | null;
    trainingLiveNote: string | null;
    trainingLiveAt?: Date | null;
    trainingLiveMinutes?: number;
  } = { trainingLiveUrl: url, trainingLiveNote: text(input.liveNote, 200) };
  if (input.liveAt !== undefined) {
    const d = input.liveAt ? new Date(String(input.liveAt)) : null;
    if (d && Number.isNaN(d.getTime()))
      throw new ApiError("That date and time isn't valid", 400);
    data.trainingLiveAt = d;
  }
  if (input.liveMinutes !== undefined) {
    const m = Math.round(Number(input.liveMinutes));
    if (!Number.isFinite(m) || m < 15 || m > 480)
      throw new ApiError(
        "The session should run between 15 and 480 minutes",
        400,
      );
    data.trainingLiveMinutes = m;
  }
  const updated = await raw.platformConfig.update({
    where: { id: cfg.id },
    data,
  });
  // The session moved: everyone with a spot keeps it, at the new time, and is told.
  const old = cfg.trainingLiveAt;
  const next = updated.trainingLiveAt;
  if (
    old &&
    next &&
    next.getTime() !== old.getTime() &&
    next.getTime() > Date.now()
  ) {
    const moving = await raw.trainingReservation.findMany({
      where: { sessionAt: old },
    });
    for (const r of moving) {
      const moved = await raw.trainingReservation.update({
        where: { id: r.id },
        data: { sessionAt: next },
      });
      await sendSpotNotices(updated, moved, { moved: true });
    }
  }
  return {
    liveUrl: updated.trainingLiveUrl,
    liveNote: updated.trainingLiveNote,
    liveAt: updated.trainingLiveAt,
    liveMinutes: updated.trainingLiveMinutes,
  };
};

export const settings = async () => {
  const cfg = await config();
  return {
    liveUrl: cfg.trainingLiveUrl,
    liveNote: cfg.trainingLiveNote,
    liveAt: cfg.trainingLiveAt,
    liveMinutes: cfg.trainingLiveMinutes,
  };
};
