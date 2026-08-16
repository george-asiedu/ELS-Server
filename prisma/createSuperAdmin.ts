/**
 * Create (or reset) the platform super admin — the operator of the /platform
 * dashboard. The super admin has no studio (studioId = null) and can provision,
 * suspend and impersonate studios.
 *
 * Idempotent: re-running updates the password for an existing super admin.
 *
 *   SUPER_ADMIN_EMAIL=you@example.com SUPER_ADMIN_PASSWORD='Str0ng!pass' \
 *     npx ts-node prisma/createSuperAdmin.ts
 *
 * Uses the RAW Prisma client so the tenant scoping extension doesn't interfere.
 */
// Load .env first — standalone scripts don't get env from the Prisma CLI.
import "dotenv/config";
import * as bcrypt from "bcrypt";
import { PrismaClient } from "../src/generated/prisma-client/client";

const prisma = new PrismaClient({} as never);

async function main() {
  const email = (process.env.SUPER_ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD || "";

  if (!email || !password) {
    throw new Error(
      "Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD (>= 8 chars) in the environment.",
    );
  }
  if (password.length < 8) {
    throw new Error("SUPER_ADMIN_PASSWORD must be at least 8 characters.");
  }

  const hashed = await bcrypt.hash(password, await bcrypt.genSalt(10));

  // A super admin has no studio, so it can't clash with any studio's (studioId,
  // email) unique key. Match on email + role to find an existing one.
  const existing = await prisma.user.findFirst({
    where: { email, role: "SUPER_ADMIN" },
  });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { password: hashed },
    });
    console.log(`Super admin password reset for ${email}`);
  } else {
    const created = await prisma.user.create({
      data: { email, password: hashed, role: "SUPER_ADMIN", studioId: null },
    });
    console.log(`Super admin created: ${email} -> ${created.id}`);
  }
}

main()
  .catch((e) => {
    console.error("createSuperAdmin failed:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
