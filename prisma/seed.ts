import "dotenv/config";
import * as bcrypt from "bcrypt";
import { PrismaClient } from "../src/generated/prisma-client/client";
import { generateReferralCode } from "../src/utils/helper";

const prisma = new PrismaClient();

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || "admin@elsbeauty.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "Admin@1234";
const CUSTOMER_EMAIL = process.env.SEED_CUSTOMER_EMAIL || "customer@elsbeauty.com";
const CUSTOMER_PASSWORD = process.env.SEED_CUSTOMER_PASSWORD || "Customer@1234";

const services = [
  // Nails
  { name: "Full Set Acrylics", category: "nails", description: "Full set of sculpted acrylic nails with your choice of shape and length", duration: "2 hrs", price: 65, popular: true },
  { name: "Acrylic Fill", category: "nails", description: "Maintenance fill for existing acrylic nails", duration: "1.5 hrs", price: 45, popular: false },
  { name: "Gel Manicure", category: "nails", description: "Long-lasting gel polish with nail shaping and cuticle care", duration: "1 hr", price: 40, popular: true },
  { name: "Classic Manicure", category: "nails", description: "Traditional manicure with nail shaping, cuticle care, and polish", duration: "45 min", price: 25, popular: false },
  { name: "Spa Pedicure", category: "nails", description: "Relaxing pedicure with exfoliation, massage, and polish", duration: "1 hr", price: 50, popular: false },
  { name: "Nail Art Add-on", category: "nails", description: "Custom nail art designs (per nail)", duration: "15 min", price: 5, popular: false },
  // Lashes
  { name: "Classic Lash Set", category: "lashes", description: "Natural-looking lash extensions, one extension per natural lash", duration: "2 hrs", price: 120, popular: true },
  { name: "Hybrid Lash Set", category: "lashes", description: "Mix of classic and volume lashes for a textured look", duration: "2.5 hrs", price: 150, popular: false },
  { name: "Volume Lash Set", category: "lashes", description: "Multiple lightweight extensions per lash for dramatic fullness", duration: "3 hrs", price: 180, popular: true },
  { name: "Lash Fill", category: "lashes", description: "Maintenance fill for existing lash extensions (2-3 weeks)", duration: "1 hr", price: 60, popular: false },
  { name: "Lash Removal", category: "lashes", description: "Safe removal of existing lash extensions", duration: "30 min", price: 25, popular: false },
  // Hair
  { name: "Silk Press", category: "hair", description: "Wash, blow-dry and silk press for a smooth, sleek finish", duration: "1.5 hrs", price: 70, popular: true },
  { name: "Knotless Braids", category: "hair", description: "Protective knotless box braids in your choice of length", duration: "4 hrs", price: 160, popular: true },
  { name: "Wig Install", category: "hair", description: "Custom lace wig install with styling and laid edges", duration: "2 hrs", price: 120, popular: false },
  { name: "Wash & Style", category: "hair", description: "Cleansing shampoo, condition and blow-out with styling", duration: "1 hr", price: 55, popular: false },
] as const;

const businessHours = [
  { dayOfWeek: 0, openTime: null, closeTime: null, isClosed: true },
  { dayOfWeek: 1, openTime: "09:00", closeTime: "18:00", isClosed: false },
  { dayOfWeek: 2, openTime: "09:00", closeTime: "18:00", isClosed: false },
  { dayOfWeek: 3, openTime: "09:00", closeTime: "18:00", isClosed: false },
  { dayOfWeek: 4, openTime: "09:00", closeTime: "18:00", isClosed: false },
  { dayOfWeek: 5, openTime: "09:00", closeTime: "18:00", isClosed: false },
  { dayOfWeek: 6, openTime: "10:00", closeTime: "16:00", isClosed: false },
];

async function seedUser(
  email: string,
  password: string,
  role: "ADMIN" | "CUSTOMER",
  fullName: string,
  phone?: string,
) {
  const hashed = await bcrypt.hash(password, 10);
  const user = await prisma.user.upsert({
    where: { email },
    update: { role },
    create: { email, password: hashed, role },
  });

  await prisma.profile.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, fullName, email, ...(phone ? { phone } : {}) },
  });
  await prisma.loyaltyPoints.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id },
  });
  await prisma.referralCode.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, code: generateReferralCode() },
  });

  console.log(`✔ ${role} user ready: ${email}`);
  return user;
}

// Give the sample customer a completed appointment + matching points so the
// review and rewards flows can be demoed straight after seeding.
async function seedCustomerActivity(customerId: string) {
  const existing = await prisma.appointment.findFirst({
    where: { userId: customerId },
  });
  if (existing) {
    console.log("• Sample customer already has activity; skipping.");
    return;
  }

  const service = await prisma.service.findFirst({ where: { category: "nails" } });
  if (!service) return;

  const lastWeek = new Date();
  lastWeek.setDate(lastWeek.getDate() - 7);

  await prisma.appointment.create({
    data: {
      fullName: "Ama Customer",
      phone: "+233201112222",
      email: CUSTOMER_EMAIL,
      appointmentDate: new Date(lastWeek.toISOString().slice(0, 10) + "T00:00:00.000Z"),
      appointmentTime: "10:00 AM",
      status: "COMPLETED",
      totalPrice: service.price,
      serviceId: service.id,
      userId: customerId,
    },
  });

  // Give the demo customer a healthy starting balance so the discount-at-booking
  // flow is easy to try (500 pts = GHS 50 of potential discount).
  const points = 500;
  await prisma.loyaltyPoints.update({
    where: { userId: customerId },
    data: { points, lifetimePoints: points },
  });
  await prisma.loyaltyTransaction.create({
    data: {
      userId: customerId,
      points,
      type: "EARNED",
      description: "Welcome demo points",
    },
  });

  console.log(`✔ Sample customer has 1 completed appointment and ${points} points.`);
}

const categories = [
  { name: "Nails", slug: "nails", order: 0 },
  { name: "Lashes", slug: "lashes", order: 1 },
  { name: "Hair", slug: "hair", order: 2 },
];

async function seedCategories() {
  for (const c of categories) {
    await prisma.category.upsert({
      where: { slug: c.slug },
      update: {},
      create: { name: c.name, slug: c.slug, order: c.order, active: true },
    });
  }
  console.log("✔ Categories ready (nails, lashes, hair).");
}

async function seedServices() {
  const count = await prisma.service.count();
  if (count > 0) {
    console.log(`• Services already present (${count}); skipping.`);
    return;
  }
  await prisma.service.createMany({ data: services as unknown as any[] });
  console.log(`✔ Seeded ${services.length} services (nails, lashes, hair).`);
}

async function seedBusinessHours() {
  for (const h of businessHours) {
    await prisma.businessHours.upsert({
      where: { dayOfWeek: h.dayOfWeek },
      update: {},
      create: h,
    });
  }
  console.log("✔ Business hours ready (Mon-Sat open, Sun closed).");
}

// Reviews are written by customers, never the admin.
async function seedReviews(customerId: string) {
  const count = await prisma.review.count();
  if (count > 0) {
    console.log(`• Reviews already present (${count}); skipping.`);
    return;
  }
  const all = await prisma.service.findMany();
  const byCategory = (c: string) => all.find((s) => s.category === c);

  const samples = [
    { rating: 5, content: "Absolutely love my nails! El is so talented and always makes sure I leave feeling beautiful. The attention to detail is incredible.", category: "nails" },
    { rating: 5, content: "Best lash extensions I have ever had! They look so natural and last for weeks. Highly recommend El's Beauty Studio!", category: "lashes" },
    { rating: 5, content: "My silk press came out flawless and lasted for days. El really listens to what you want and delivers beyond expectations!", category: "hair" },
    { rating: 4, content: "Great service and beautiful results. The booking process was easy and the studio has such a welcoming atmosphere.", category: "nails" },
  ];

  for (const s of samples) {
    const svc = byCategory(s.category);
    await prisma.review.create({
      data: {
        rating: s.rating,
        content: s.content,
        approved: true,
        userId: customerId,
        ...(svc ? { serviceId: svc.id } : {}),
      },
    });
  }
  console.log(`✔ Seeded ${samples.length} approved sample reviews (by the customer).`);
}

async function main() {
  console.log("Seeding ELS database...");
  const admin = await seedUser(ADMIN_EMAIL, ADMIN_PASSWORD, "ADMIN", "Studio Admin");
  const customer = await seedUser(
    CUSTOMER_EMAIL,
    CUSTOMER_PASSWORD,
    "CUSTOMER",
    "Ama Customer",
    "+233201112222",
  );
  void admin;

  await seedCategories();
  await seedServices();
  await seedBusinessHours();
  await seedCustomerActivity(customer.id);
  await seedReviews(customer.id);

  console.log("\nDone. Two separate accounts:");
  console.log(`  ADMIN    → ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}  (studio dashboard)`);
  console.log(`  CUSTOMER → ${CUSTOMER_EMAIL} / ${CUSTOMER_PASSWORD}  (booking + rewards)`);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
