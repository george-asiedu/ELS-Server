import { randomBytes } from "crypto";
import { ApiError } from "../middleware/apiError";
import { HttpCode } from "../models/status_codes";
import { createTenantClient } from "../tenant/tenantClient";
import { getPasswordHash } from "../utils/helper";
import { NotificationService } from "../notifications/notificationService";
import { NotificationTemplate } from "../notifications/registry";
import { staffAccountCreated } from "../notifications/templates/staffAccount";
import { platformBrand } from "../notifications/brand";
import { Connection } from "../db/dbConnection";
import { revokeLoginSessions } from "../auth/sessionService";
import { getTenantContext } from "../tenant/context";

const { db } = createTenantClient();
const notifications = new NotificationService();

/** Sends the welcome email with the studio's own look and address. */
class StaffMailer extends Connection {
  public async welcome(args: { name: string; email: string; userId: string }) {
    const [brand, studio, loginUrl] = await Promise.all([
      this.studioEmailBrand(null, platformBrand),
      this.currentStudioBranding(),
      this.linkToStudio("/admin/login"),
    ]);
    const { subject, html } = staffAccountCreated(brand, {
      name: args.name,
      studioName: studio?.name ?? "your studio",
      email: args.email,
      loginUrl,
    });
    await notifications.send({
      template: NotificationTemplate.STAFF_ACCOUNT_CREATED,
      to: args.email,
      subject,
      html,
      studioId: getTenantContext()?.studioId ?? null,
      entityType: "User",
      entityId: args.userId,
    });
  }
}
const mailer = new StaffMailer();

type StaffRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  userId: string | null;
};

const clash = (message: string) => new ApiError(message, HttpCode.CONFLICT);

/**
 * Give a staff member their sign-in account straight away: no password yet (they
 * set their own on their first visit) and no invite. A person who is already an
 * admin here (the owner who also works the chair) keeps their account and is
 * simply linked, so they get the alerts too.
 */
export const ensureStaffAccount = async (
  staff: StaffRow,
): Promise<string | null> => {
  const email = staff.email?.trim().toLowerCase();
  if (!email) return null;

  const existing = await db.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, role: true },
  });
  if (existing) {
    if (existing.role === "CUSTOMER")
      throw clash(
        "That email already has a customer account here. Use a different email for this person.",
      );
    const taken = await db.staff.findFirst({
      where: { userId: existing.id, NOT: { id: staff.id } },
      select: { id: true },
    });
    if (taken)
      throw clash("That email already belongs to another team member.");
    await db.staff.update({
      where: { id: staff.id },
      data: { userId: existing.id },
    });
    return existing.id;
  }

  const user = await db.user.create({
    data: {
      email,
      // Nobody knows this: it only fills the column until they set their own.
      password: await getPasswordHash(randomBytes(24).toString("hex")),
      role: "STAFF",
      passwordSet: false,
    },
    select: { id: true },
  });
  await db.profile.create({
    data: {
      userId: user.id,
      fullName: staff.name,
      email,
      ...(staff.phone ? { phone: staff.phone } : {}),
    },
  });
  await db.staff.update({ where: { id: staff.id }, data: { userId: user.id } });

  // Best effort: tell them it's ready. It is not an invite; they sign in themselves.
  await mailer
    .welcome({ name: staff.name, email, userId: user.id })
    .catch((e) =>
      console.warn("Staff welcome email failed:", (e as Error).message),
    );
  return user.id;
};

/** Keep the account in step with the staff record when the owner edits it. */
export const syncStaffAccount = async (
  before: StaffRow,
  after: StaffRow & { active: boolean },
) => {
  if (!before.userId) {
    // Added an email to someone who had none: they get an account now.
    if (after.email) await ensureStaffAccount(after);
    return;
  }
  // The email was cleared: the login goes with it (an admin's account stays).
  if (!after.email) {
    await removeStaffAccount(before);
    await db.staff.update({ where: { id: before.id }, data: { userId: null } });
    return;
  }
  const user = await db.user.findUnique({
    where: { id: before.userId },
    select: { id: true, role: true, email: true },
  });
  if (!user) return;
  // An admin linked as staff is managed from their own account, not here.
  if (user.role === "STAFF") {
    const email = after.email?.trim().toLowerCase();
    if (email && email !== user.email.toLowerCase()) {
      const used = await db.user.findFirst({
        where: {
          email: { equals: email, mode: "insensitive" },
          NOT: { id: user.id },
        },
        select: { id: true },
      });
      if (used) throw clash("That email already has an account here.");
      await db.user.update({ where: { id: user.id }, data: { email } });
      await revokeLoginSessions(user.id);
    }
    await db.profile
      .update({
        where: { userId: user.id },
        data: {
          fullName: after.name,
          ...(after.email ? { email: after.email } : {}),
          phone: after.phone ?? null,
        },
      })
      .catch(() => undefined);
  }
  // Turned off: signed out everywhere, and sign-in refuses them until turned on.
  if (!after.active) await revokeLoginSessions(user.id);
};

/** The person was removed: so is their account, unless it is an admin's. */
export const removeStaffAccount = async (staff: { userId: string | null }) => {
  if (!staff.userId) return;
  const user = await db.user.findUnique({
    where: { id: staff.userId },
    select: { id: true, role: true },
  });
  if (!user || user.role !== "STAFF") return;
  await revokeLoginSessions(user.id);
  await db.user.delete({ where: { id: user.id } });
};
