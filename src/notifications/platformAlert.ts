import { createTenantClient } from "../tenant/tenantClient";
import { env } from "../config/env.config";
import { NotificationService } from "./notificationService";
import { NotificationTemplateKey } from "./registry";
import { notifyUsers } from "../push/pushService";

const { raw } = createTenantClient();
const notifications = new NotificationService();

/**
 * Tell the Zuri team something happened (a studio asked for a feature or for
 * training): an email to the platform address and to every super admin, and a
 * push notification to every super admin's devices. Best-effort: it never
 * throws, because the request the studio just made has already been saved.
 */
export const alertPlatform = async (args: {
  template: NotificationTemplateKey;
  subject: string;
  html: string;
  studioId: string;
  entityType: string;
  entityId: string;
  push: { title: string; body: string; url: string };
}): Promise<void> => {
  try {
    const admins = await raw.user.findMany({
      where: { role: "SUPER_ADMIN" },
      select: { id: true, email: true },
    });
    const to = [
      ...new Set(
        [env.platformEmail, ...admins.map((a) => a.email)]
          .filter(Boolean)
          .map((e) => e.trim().toLowerCase()),
      ),
    ];
    for (const address of to) {
      await notifications.send({
        template: args.template,
        to: address,
        subject: args.subject,
        html: args.html,
        studioId: args.studioId,
        entityType: args.entityType,
        entityId: args.entityId,
      });
    }
    await notifyUsers(
      admins.map((a) => a.id),
      args.push,
    ).catch(() => 0);
  } catch (error) {
    console.error("Platform alert failed:", (error as Error).message);
  }
};
