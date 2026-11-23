import { env } from "../config/env.config";
import { createTenantClient } from "../tenant/tenantClient";
import { toWhatsappNumber } from "../utils/whatsapp";
import { whatsappQueue, type WhatsappJobData } from "../queue/queues";

// Booking messages to customers on WhatsApp, through Meta's WhatsApp Cloud API.
// Business-started messages must use templates Meta has approved, so each
// message is a template name plus its variables, in order. Sent only when the
// platform has WhatsApp set up AND the studio has switched it on; each message
// is billed by Meta. Never throws: email and push still go out regardless.

const { raw } = createTenantClient();

export const whatsappConfigured = Boolean(
  env.whatsapp.token && env.whatsapp.phoneNumberId,
);

export type WhatsappKind = "CONFIRMED" | "REMINDER_24H" | "REMINDER_1H";

/**
 * Template variables, in order:
 *   1 customer's first name, 2 studio name, 3 service, 4 date, 5 time,
 *   and for reminders 6 "tomorrow" or "in about an hour".
 * The Meta templates must be written to match (see .env.example).
 */
export const deliverBookingWhatsapp = async (args: {
  kind: WhatsappKind;
  studioId: string;
  appointmentId: string;
  phone: string;
  firstName: string;
  studioName: string;
  serviceName: string;
  date: string;
  time: string;
}) => {
  if (!whatsappConfigured) return false;
  try {
    const settings = await raw.studioSettings.findUnique({
      where: { studioId: args.studioId },
      select: { whatsappMessages: true },
    });
    if (!settings?.whatsappMessages) return false;
    const to = toWhatsappNumber(args.phone);
    if (!to) return false;

    // One message per booking per kind, even if a sweep runs twice.
    try {
      await raw.notificationLog.create({
        data: {
          studioId: args.studioId,
          template: `WHATSAPP_${args.kind}`,
          recipient: to,
          entityType: "Appointment",
          entityId: args.appointmentId,
          status: "QUEUED",
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") return false;
      throw e;
    }

    const params = [
      args.firstName,
      args.studioName,
      args.serviceName,
      args.date,
      args.time,
    ];
    if (args.kind !== "CONFIRMED")
      params.push(
        args.kind === "REMINDER_24H" ? "tomorrow" : "in about an hour",
      );
    const res = await fetch(
      `https://graph.facebook.com/${env.whatsapp.apiVersion}/${env.whatsapp.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.whatsapp.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name:
              args.kind === "CONFIRMED"
                ? env.whatsapp.templates.confirmed
                : env.whatsapp.templates.reminder,
            language: { code: env.whatsapp.language },
            components: [
              {
                type: "body",
                parameters: params.map((text) => ({
                  type: "text",
                  text: String(text).slice(0, 200),
                })),
              },
            ],
          },
        }),
      },
    );
    const ok = res.ok;
    await raw.notificationLog.updateMany({
      where: {
        template: `WHATSAPP_${args.kind}`,
        recipient: to,
        entityId: args.appointmentId,
      },
      data: ok
        ? { status: "SENT", sentAt: new Date() }
        : { status: "FAILED", error: (await res.text()).slice(0, 500) },
    });
    return ok;
  } catch (e) {
    console.warn(`WhatsApp ${args.kind} failed:`, (e as Error).message);
    return false;
  }
};

/** Adds the message to the WhatsApp queue, or sends it here when there isn't one. */
export const sendBookingWhatsapp = async (
  args: WhatsappJobData,
): Promise<boolean> => {
  if (!whatsappConfigured) return false;
  if (whatsappQueue) {
    try {
      await whatsappQueue.add("send", args);
      return true;
    } catch (e) {
      console.warn("Couldn't queue a WhatsApp message:", (e as Error).message);
    }
  }
  return deliverBookingWhatsapp(args);
};
