import { ApiError } from "../middleware/apiError";
import { createTenantClient } from "../tenant/tenantClient";
import { addExtraCharge, waiveExtraCharge } from "../billing/extraCharges";
import { notifyStudioAdmins, notifyUsers } from "../push/pushService";

// Training. Online training (the guides in the dashboard and a free live
// session) costs nothing and needs no request. In-person training is a request:
// the super admin sets the fee and the date, the fee is added to the studio's
// next bill, and the studio is told at each step.

const { raw } = createTenantClient();
const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const STATUSES = ["NEW", "SCHEDULED", "DONE", "DECLINED"] as const;
type Status = (typeof STATUSES)[number];

const config = async () => (await raw.platformConfig.findFirst()) ?? (await raw.platformConfig.create({ data: {} }));

export const trainingInfo = async (studioId: string) => {
  const cfg = await config();
  const requests = await raw.trainingRequest.findMany({ where: { studioId }, orderBy: { createdAt: "desc" } });
  return { liveUrl: cfg.trainingLiveUrl, liveNote: cfg.trainingLiveNote, requests };
};

export const requestInPerson = async (studioId: string, userId: string | undefined, input: Record<string, unknown>) => {
  const open = await raw.trainingRequest.count({ where: { studioId, status: { in: ["NEW", "SCHEDULED"] } } });
  if (open >= 2) throw new ApiError("You already have training requests in progress. We'll be in touch.", 400);
  const created = await raw.trainingRequest.create({
    data: {
      studioId,
      ...(userId ? { requestedByUserId: userId } : {}),
      preferredDate: text(input.preferredDate, 80),
      location: text(input.location, 200),
      notes: text(input.notes, 500),
    },
  });
  const studio = await raw.studio.findUnique({ where: { id: studioId }, select: { name: true } });
  const admins = await raw.user.findMany({ where: { role: "SUPER_ADMIN" }, select: { id: true } });
  await notifyUsers(admins.map((a) => a.id), {
    title: "In-person training request",
    body: `${studio?.name ?? "A business"} asked for in-person training.`,
    url: "/platform/training",
  }).catch(() => 0);
  return created;
};

export const platformList = async () => {
  const rows = await raw.trainingRequest.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  return Promise.all(
    rows.map(async (r) => ({ ...r, studio: await raw.studio.findUnique({ where: { id: r.studioId }, select: { id: true, name: true, slug: true } }) })),
  );
};

/** Set the fee, the date or the status. The studio is told, and the fee goes on its next bill. */
export const platformUpdate = async (id: string, input: Record<string, unknown>) => {
  const existing = await raw.trainingRequest.findUnique({ where: { id } });
  if (!existing) throw new ApiError("Request not found", 404);
  const data: { status?: Status; feeAmount?: number; scheduledFor?: Date | null } = {};
  if (input.status !== undefined) {
    if (!STATUSES.includes(input.status as Status)) throw new ApiError("Invalid status", 400);
    data.status = input.status as Status;
  }
  if (input.feeAmount !== undefined) {
    const fee = Math.round(Number(input.feeAmount) * 100) / 100;
    if (!Number.isFinite(fee) || fee < 0 || fee > 100000) throw new ApiError("Enter a fee between 0 and 100,000", 400);
    data.feeAmount = fee;
  }
  if (input.scheduledFor !== undefined) {
    const d = input.scheduledFor ? new Date(String(input.scheduledFor)) : null;
    if (d && Number.isNaN(d.getTime())) throw new ApiError("That date isn't valid", 400);
    data.scheduledFor = d;
  }
  const updated = await raw.trainingRequest.update({ where: { id }, data });

  const when = updated.scheduledFor ? updated.scheduledFor.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }) : null;
  if (data.feeAmount !== undefined || data.status === "DECLINED") {
    if (data.status === "DECLINED") await waiveExtraCharge(existing.studioId, "TRAINING", id);
    else await addExtraCharge({ studioId: existing.studioId, kind: "TRAINING", refId: id, description: `In-person training${when ? ` (${when})` : ""}`, amount: updated.feeAmount ?? 0 });
  }
  const parts: string[] = [];
  if (data.status === "DECLINED") parts.push("We can't do this one right now.");
  else {
    if (data.scheduledFor) parts.push(`Your training is set for ${when}.`);
    if (data.feeAmount !== undefined) parts.push(data.feeAmount > 0 ? `The fee is GHS ${data.feeAmount.toFixed(2)}, added to your next renewal.` : "There's no fee for it.");
    if (data.status === "DONE") parts.push("Thanks for training with us.");
  }
  if (parts.length)
    await notifyStudioAdmins(
      existing.studioId,
      { template: "TRAINING_UPDATE", entityId: `${id}:${updated.status}:${updated.feeAmount ?? ""}:${updated.scheduledFor?.toISOString() ?? ""}`, entityType: "TrainingRequest" },
      { title: "About your in-person training", body: parts.join(" "), url: "/admin/learn" },
    ).catch(() => 0);
  return updated;
};

export const saveSettings = async (input: Record<string, unknown>) => {
  const cfg = await config();
  let url = text(input.liveUrl, 300);
  if (url && !/^https:\/\//i.test(url)) throw new ApiError("The join link should start with https://", 400);
  return raw.platformConfig.update({
    where: { id: cfg.id },
    data: { trainingLiveUrl: url, trainingLiveNote: text(input.liveNote, 200) },
    select: { trainingLiveUrl: true, trainingLiveNote: true },
  });
};

export const settings = async () => {
  const cfg = await config();
  return { liveUrl: cfg.trainingLiveUrl, liveNote: cfg.trainingLiveNote };
};
