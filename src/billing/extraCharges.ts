import { createTenantClient } from "../tenant/tenantClient";

// Money a studio owes on top of its plan (a feature request fee, extra storage,
// in-person training). Pending ones are added to the studio's next renewal and
// marked billed once that renewal is paid. See StudioExtraCharge in the schema.

const { raw } = createTenantClient();
const round2 = (n: number) => Math.round(n * 100) / 100;

type Kind = "FEATURE_REQUEST" | "STORAGE_OVERAGE" | "TRAINING" | "OTHER";

/** Add (or update, while still unbilled) one charge for a thing. */
export const addExtraCharge = async (input: {
  studioId: string;
  kind: Kind;
  refId: string;
  description: string;
  amount: number;
}) => {
  const amount = round2(input.amount);
  const key = {
    studioId_kind_refId: {
      studioId: input.studioId,
      kind: input.kind,
      refId: input.refId,
    },
  };
  const existing = await raw.studioExtraCharge.findUnique({ where: key });
  // Already on a paid bill: leave it alone.
  if (existing?.status === "BILLED") return existing;
  if (amount <= 0) {
    if (existing)
      return raw.studioExtraCharge.update({
        where: key,
        data: { status: "WAIVED" },
      });
    return null;
  }
  return raw.studioExtraCharge.upsert({
    where: key,
    create: {
      studioId: input.studioId,
      kind: input.kind,
      refId: input.refId,
      description: input.description,
      amount,
    },
    update: {
      description: input.description,
      amount,
      status: "PENDING",
      billedReference: null,
    },
  });
};

/** Take a charge off the bill (the request was withdrawn, or the fee dropped). */
export const waiveExtraCharge = async (
  studioId: string,
  kind: Kind,
  refId: string,
) => {
  await raw.studioExtraCharge.updateMany({
    where: { studioId, kind, refId, status: "PENDING" },
    data: { status: "WAIVED" },
  });
};

/**
 * Feature request fees that repeat: once a request's first charge has been
 * paid, its monthly fee is added to every renewal after it (x12 on a yearly
 * plan). Computed live, so a changed or withdrawn fee takes effect at once.
 */
const recurringExtras = async (studioId: string, months: number) => {
  const requests = await raw.featureRequest.findMany({
    where: {
      studioId,
      monthlyFee: { gt: 0 },
      status: { not: "DECLINED" },
    },
    select: { id: true, title: true, monthlyFee: true, feeSetAt: true },
  });
  if (!requests.length) return [];
  const billed = await raw.studioExtraCharge.findMany({
    where: {
      studioId,
      kind: "FEATURE_REQUEST",
      status: "BILLED",
      refId: { in: requests.map((r) => r.id) },
    },
    select: { refId: true },
  });
  const paidFirst = new Set(billed.map((b) => b.refId));
  return requests
    .filter((r) => paidFirst.has(r.id))
    .map((r) => ({
      id: `recurring-${r.id}`,
      kind: "FEATURE_REQUEST" as const,
      description: `Feature request, monthly${months > 1 ? ` (x${months})` : ""}: ${r.title}`,
      amount: round2((r.monthlyFee ?? 0) * months),
      createdAt: r.feeSetAt ?? new Date(),
    }));
};

/** What's waiting for the next renewal. */
export const pendingExtras = async (
  studioId: string,
  cadence: "MONTHLY" | "YEARLY" = "MONTHLY",
  // Monthly feature fees belong to renewals only. A stand-alone "pay extras
  // now" must not take them, or they would be charged twice.
  withRecurring = true,
) => {
  const months = cadence === "YEARLY" ? 12 : 1;
  const recurring = withRecurring
    ? await recurringExtras(studioId, months)
    : [];
  const pending = await raw.studioExtraCharge.findMany({
    where: { studioId, status: "PENDING" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      kind: true,
      description: true,
      amount: true,
      createdAt: true,
    },
  });
  const items = [...pending, ...recurring];
  return { items, total: round2(items.reduce((s, i) => s + i.amount, 0)) };
};

/** Tie the pending charges to a renewal that's about to be paid. */
export const reserveExtras = async (studioId: string, reference: string) => {
  await raw.studioExtraCharge.updateMany({
    where: { studioId, status: "PENDING" },
    data: { billedReference: reference },
  });
};

/** The renewal was paid: those charges are now billed. */
export const markExtrasBilled = async (studioId: string, reference: string) => {
  await raw.studioExtraCharge.updateMany({
    where: { studioId, status: "PENDING", billedReference: reference },
    data: { status: "BILLED", billedAt: new Date() },
  });
};
