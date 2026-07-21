import "dotenv/config";
import * as bcrypt from "bcrypt";
import { PrismaClient } from "../src/generated/prisma-client/client";

const prisma = new PrismaClient();

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || "admin@elsbeauty.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "Admin@1234";

const services = [
  // Nails
  { name: "Full Set Acrylics", category: "NAILS", description: "Full set of sculpted acrylic nails with your choice of shape and length", duration: "2 hrs", price: 65, popular: true },
  { name: "Acrylic Fill", category: "NAILS", description: "Maintenance fill for existing acrylic nails", duration: "1.5 hrs", price: 45, popular: false },
  { name: "Gel Manicure", category: "NAILS", description: "Long-lasting gel polish with nail shaping and cuticle care", duration: "1 hr", price: 40, popular: true },
  { name: "Classic Manicure", category: "NAILS", description: "Traditional manicure with nail shaping, cuticle care, and polish", duration: "45 min", price: 25, popular: false },
  { name: "Spa Pedicure", category: "NAILS", description: "Relaxing pedicure with exfoliation, massage, and polish", duration: "1 hr", price: 50, popular: false },
  { name: "Nail Art Add-on", category: "NAILS", description: "Custom nail art designs (per nail)", duration: "15 min", price: 5, popular: false },
  // Lashes
  { name: "Classic Lash Set", category: "LASHES", description: "Natural-looking lash extensions, one extension per natural lash", duration: "2 hrs", price: 120, popular: true },
  { name: "Hybrid Lash Set", category: "LASHES", description: "Mix of classic and volume lashes for a textured look", duration: "2.5 hrs", price: 150, popular: false },
  { name: "Volume Lash Set", category: "LASHES", description: "Multiple lightweight extensions per lash for dramatic fullness", duration: "3 hrs", price: 180, popular: true },
  { name: "Lash Fill", category: "LASHES", description: "Maintenance fill for existing lash extensions (2-3 weeks)", duration: "1 hr", price: 60, popular: false },
  { name: "Lash Removal", category: "LASHES", description: "Safe removal of existing lash extensions", duration: "30 min", price: 25, popular: false },
  // Hair
  { name: "Silk Press", category: "HAIR", description: "Wash, blow-dry and silk press for a smooth, sleek finish", duration: "1.5 hrs", price: 70, popular: true },
  { name: "Knotless Braids", category: "HAIR", description: "Protective knotless box braids in your choice of length", duration: "4 hrs", price: 160, popular: true },
  { name: "Wig Install", category: "HAIR", description: "Custom lace wig install with styling and laid edges", duration: "2 hrs", price: 120, popular: false },
  { name: "Wash & Style", category: "HAIR", description: "Cleansing shampoo, condition and blow-out with styling", duration: "1 hr", price: 55, popular: false },
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

async function seedAdmin() {
  const hashed = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { role: "ADMIN" },
    create: { email: ADMIN_EMAIL, password: hashed, role: "ADMIN" },
  });

  await prisma.profile.upsert({
    where: { userId: admin.id },
    update: {},
    create: { userId: admin.id, fullName: "Studio Admin", email: ADMIN_EMAIL },
  });
  await prisma.loyaltyPoints.upsert({
    where: { userId: admin.id },
    update: {},
    create: { userId: admin.id },
  });
  await prisma.referralCode.upsert({
    where: { userId: admin.id },
    update: {},
    create: { userId: admin.id, code: `ELS${admin.id.slice(-6).toUpperCase()}` },
  });

  console.log(`✔ Admin user ready: ${ADMIN_EMAIL}`);
  return admin;
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
  console.log("✔ Business hours ready (Mon–Sat open, Sun closed).");
}

async function seedReviews(adminId: string) {
  const count = await prisma.review.count();
  if (count > 0) {
    console.log(`• Reviews already present (${count}); skipping.`);
    return;
  }
  const all = await prisma.service.findMany();
  const byCategory = (c: string) => all.find((s) => s.category === c);

  const samples = [
    { rating: 5, content: "Absolutely love my nails! El is so talented and always makes sure I leave feeling beautiful. The attention to detail is incredible.", category: "NAILS" },
    { rating: 5, content: "Best lash extensions I have ever had! They look so natural and last for weeks. Highly recommend El's Beauty Studio!", category: "LASHES" },
    { rating: 5, content: "My silk press came out flawless and lasted for days. El really listens to what you want and delivers beyond expectations!", category: "HAIR" },
    { rating: 4, content: "Great service and beautiful results. The booking process was easy and the studio has such a welcoming atmosphere.", category: "NAILS" },
  ];

  for (const s of samples) {
    const svc = byCategory(s.category);
    await prisma.review.create({
      data: {
        rating: s.rating,
        content: s.content,
        approved: true,
        userId: adminId,
        ...(svc ? { serviceId: svc.id } : {}),
      },
    });
  }
  console.log(`✔ Seeded ${samples.length} approved sample reviews.`);
}

async function main() {
  console.log("Seeding ELS database...");
  const admin = await seedAdmin();
  await seedServices();
  await seedBusinessHours();
  await seedReviews(admin.id);
  console.log("\nDone. Admin login:");
  console.log(`  email:    ${ADMIN_EMAIL}`);
  console.log(`  password: ${ADMIN_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
