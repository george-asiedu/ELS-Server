/**
 * One-time backfill for the multi-tenant migration.
 *
 * Creates the first studio (El's) and stamps `studioId` onto every existing
 * document across all tenant-owned collections, then seeds El's per-studio
 * settings/branding/content from the existing single-tenant singletons.
 *
 * Safe to re-run: it only stamps documents that don't yet have a studioId and
 * upserts the studio + its config. Run it immediately after `prisma db push`
 * (while the app is stopped) so no request hits a required-but-missing field.
 *
 *   DEFAULT_STUDIO_SLUG=els DEFAULT_STUDIO_NAME="El's Beauty Studio" \
 *     npx ts-node prisma/backfillTenants.ts
 *
 * Uses the RAW Prisma client on purpose so the tenant scoping extension does
 * not interfere with the migration.
 */
// Load .env first — standalone scripts don't get env from the Prisma CLI.
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma-client/client";

const prisma = new PrismaClient({} as never);

const SLUG = process.env.DEFAULT_STUDIO_SLUG || "els";
const NAME = process.env.DEFAULT_STUDIO_NAME || "El's Beauty Studio";

// Every tenant-owned collection (delegate names). Order doesn't matter — each
// is stamped independently.
const TENANT_MODELS = [
  "user",
  "profile",
  "appointment",
  "service",
  "serviceAddOn",
  "payment",
  "paymentSettings",
  "review",
  "gallery",
  "category",
  "businessHours",
  "blockedDate",
  "contactInfo",
  "loyaltyPoints",
  "loyaltyTransaction",
  "referralCode",
  "referral",
  "product",
  "productCategory",
  "cart",
  "cartItem",
  "order",
  "orderItem",
  "referralOrderReward",
  "commerceSettings",
] as const;

async function main() {
  // 1. Create (or find) the studio.
  let studio = await prisma.studio.findUnique({ where: { slug: SLUG } });
  if (!studio) {
    studio = await prisma.studio.create({
      data: { name: NAME, slug: SLUG, status: "ACTIVE" },
    });
    console.log(`Created studio "${NAME}" (${SLUG}) -> ${studio.id}`);
  } else {
    console.log(`Studio "${SLUG}" already exists -> ${studio.id}`);
  }
  const studioId = studio.id;

  // 2. Stamp studioId onto every existing document lacking one.
  console.log("Stamping studioId across collections...");
  for (const model of TENANT_MODELS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const delegate = (prisma as any)[model];
    const res = await delegate.updateMany({
      where: { studioId: null },
      data: { studioId },
    });
    console.log(`  ${model}: ${res.count} stamped`);
  }

  // 3. Point the studio at its owner (the existing admin), if unset.
  if (!studio.ownerUserId) {
    const admin = await prisma.user.findFirst({
      where: { role: "ADMIN", studioId },
    });
    if (admin) {
      await prisma.studio.update({
        where: { id: studioId },
        data: { ownerUserId: admin.id },
      });
      console.log(`  owner set -> ${admin.email} (${admin.id})`);
    } else {
      console.log("  no ADMIN user found; owner left unset");
    }
  }

  // 4. Seed feature flags from the existing single-tenant settings.
  const commerce = await prisma.commerceSettings.findFirst({ where: { studioId } });
  const payment = await prisma.paymentSettings.findFirst({ where: { studioId } });
  await prisma.studioSettings.upsert({
    where: { studioId },
    update: {},
    create: {
      studioId,
      commerce: commerce?.enabled ?? false,
      onlinePayments: payment?.enabled ?? false,
      loyalty: true,
      referrals: true,
      reviews: true,
      gallery: true,
      productsInBooking: true,
    },
  });
  console.log("  studio settings seeded");

  // 5. Default branding + content shells (studio admin fills these in).
  await prisma.studioBranding.upsert({
    where: { studioId },
    update: {},
    create: { studioId },
  });
  await prisma.studioContent.upsert({
    where: { studioId },
    update: {},
    create: { studioId, showTestimonials: true },
  });
  console.log("  branding + content shells created");

  console.log("Backfill complete.");
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
