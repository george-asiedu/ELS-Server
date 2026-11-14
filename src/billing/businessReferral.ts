import { createTenantClient } from "../tenant/tenantClient";
import { notifyStudioAdmins } from "../push/pushService";

// Business referrals: a business shares its invite link; when a new business
// signs up through it and pays, both get their next monthly renewal free.
// Businesses on revenue share have no renewal to discount, so for them the
// referral is recorded for the platform to reward by hand.

const { raw } = createTenantClient();
const GRACE_DAYS = 14;

/** A free next renewal: 100% off until a little after the period ends. */
const freeNextRenewal = async (studioId: string) => {
  const s = await raw.studio.findUnique({
    where: { id: studioId },
    select: { billingMode: true, currentPeriodEnd: true, billingDiscountPercent: true, billingDiscountEndsAt: true },
  });
  if (!s || s.billingMode !== "SUBSCRIPTION") return false;
  const base = s.currentPeriodEnd && s.currentPeriodEnd > new Date() ? s.currentPeriodEnd : new Date();
  const endsAt = new Date(base.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000);
  // Keep a better discount that's already running.
  const current = s.billingDiscountPercent ?? 0;
  const currentEnds = s.billingDiscountEndsAt;
  if (current >= 100 && (!currentEnds || currentEnds >= endsAt)) return true;
  await raw.studio.update({
    where: { id: studioId },
    data: { billingDiscountPercent: 100, billingDiscountEndsAt: endsAt, billingNote: "Free month for a business referral" },
  });
  return true;
};

export const rewardBusinessReferral = async (referrerSlug: string, newStudioId: string) => {
  const referrer = await raw.studio.findFirst({ where: { slug: referrerSlug, status: "ACTIVE" }, select: { id: true, name: true } });
  if (!referrer || referrer.id === newStudioId) return;
  await raw.studio.update({ where: { id: newStudioId }, data: { referredByStudioId: referrer.id } });
  const [referrerRewarded, newRewarded] = await Promise.all([freeNextRenewal(referrer.id), freeNextRenewal(newStudioId)]);
  const newcomer = await raw.studio.findUnique({ where: { id: newStudioId }, select: { name: true } });
  await notifyStudioAdmins(
    referrer.id,
    { template: "BUSINESS_REFERRAL", entityId: newStudioId, entityType: "Studio" },
    {
      title: "Thanks for the referral",
      body: referrerRewarded
        ? `${newcomer?.name ?? "A business"} joined Zuri with your invite. Your next month is free.`
        : `${newcomer?.name ?? "A business"} joined Zuri with your invite. We'll be in touch about your reward.`,
      url: "/admin/billing",
    },
  ).catch(() => 0);
  if (newRewarded)
    await notifyStudioAdmins(
      newStudioId,
      { template: "BUSINESS_REFERRAL_WELCOME", entityId: newStudioId, entityType: "Studio" },
      { title: "Your next month is free", body: `Because ${referrer.name} invited you, your next monthly renewal is on us.`, url: "/admin/billing" },
    ).catch(() => 0);
};

/** For the Billing page: the invite link's address and how many joined. */
export const referralSummary = async (studioId: string) => {
  const studio = await raw.studio.findUnique({ where: { id: studioId }, select: { slug: true } });
  const joined = await raw.studio.count({ where: { referredByStudioId: studioId } });
  return { slug: studio?.slug ?? "", joined };
};
