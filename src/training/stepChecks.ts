import { createTenantClient } from "../tenant/tenantClient";

// The Learn page's steps, checked against what the business has really done.
// A step only counts as finished when the data proves it, so nobody can tick
// their way to "trained" without doing the work. Ids are stable: the web page
// keys its explanations off them.

const { raw } = createTenantClient();

export interface StepCheck {
  done: boolean;
  // Shown when it isn't done yet: exactly what is still missing.
  missing: string;
}

export const LEARN_STEP_IDS = [
  "branding",
  "contact",
  "hours",
  "services",
  "staff",
  "gallery",
  "products",
  "delivery",
  "offers",
  "payout",
  "bills",
  "bookings",
  "orders",
  "notifications",
  "goal",
] as const;
export type LearnStepId = (typeof LEARN_STEP_IDS)[number];

export const verifyLearnSteps = async (
  studioId: string,
): Promise<Record<LearnStepId, StepCheck>> => {
  const [
    studio,
    branding,
    contact,
    hours,
    services,
    staff,
    gallery,
    products,
    commerce,
    coupons,
    sales,
    bills,
    bookings,
    orders,
    settings,
    admins,
  ] = await Promise.all([
    raw.studio.findUnique({
      where: { id: studioId },
      select: { paystackSubaccountCode: true },
    }),
    raw.studioBranding.findUnique({ where: { studioId } }),
    raw.contactInfo.findUnique({ where: { studioId } }),
    raw.businessHours.count({ where: { studioId } }),
    raw.service.count({ where: { studioId } }),
    raw.staff.count({ where: { studioId } }),
    raw.gallery.count({ where: { studioId } }),
    raw.product.count({ where: { studioId } }),
    raw.commerceSettings.findUnique({ where: { studioId } }),
    raw.coupon.count({ where: { studioId } }),
    raw.salePromo.count({ where: { studioId } }),
    raw.bill.count({ where: { studioId } }),
    raw.appointment.count({
      where: { studioId, status: { in: ["CONFIRMED", "COMPLETED"] } },
    }),
    raw.order.count({ where: { studioId, status: "FULFILLED" } }),
    raw.studioSettings.findUnique({ where: { studioId } }),
    raw.user.findMany({
      where: { studioId, role: "ADMIN" },
      select: { id: true },
    }),
  ]);
  const pushes = admins.length
    ? await raw.pushSubscription.count({
        where: { userId: { in: admins.map((a) => a.id) } },
      })
    : 0;

  const check = (done: boolean, missing: string): StepCheck => ({
    done,
    missing,
  });
  return {
    branding: check(
      Boolean(branding?.logoUrl),
      "Upload your logo in Appearance and save.",
    ),
    contact: check(
      Boolean(
        contact?.phone ||
        contact?.whatsapp ||
        contact?.email ||
        contact?.address,
      ),
      "Add at least a phone number, WhatsApp, email or address on the Contact page and save.",
    ),
    hours: check(hours > 0, "Set your opening hours and save."),
    services: check(services > 0, "Add your first service."),
    staff: check(staff > 0, "Add a team member."),
    gallery: check(gallery > 0, "Upload a photo to your gallery."),
    products: check(products > 0, "Add your first product."),
    delivery: check(
      Boolean(
        commerce &&
        commerce.updatedAt.getTime() - commerce.createdAt.getTime() > 1000,
      ),
      "Choose pickup or delivery and save your delivery settings.",
    ),
    offers: check(coupons + sales > 0, "Create a coupon or schedule a sale."),
    payout: check(
      Boolean(studio?.paystackSubaccountCode),
      "Connect your payout account in Payments.",
    ),
    bills: check(bills > 0, "Create your first bill."),
    bookings: check(
      bookings > 0,
      "Confirm a booking (or complete one) in Appointments.",
    ),
    orders: check(
      orders > 0,
      "Move an order all the way to delivered or collected.",
    ),
    notifications: check(
      pushes > 0,
      "Turn on notifications on your phone from the Security page.",
    ),
    goal: check(
      settings?.revenueGoal != null,
      "Set your monthly goal in Insights.",
    ),
  };
};
