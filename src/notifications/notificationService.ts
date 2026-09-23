import { Connection } from "../db/dbConnection";
import { emailQueue } from "../queue/queues";
import { sendEmailNow } from "../email/emailService";
import { NotificationTemplateKey } from "./registry";

export interface SendNotificationArgs {
  template: NotificationTemplateKey;
  to: string;
  subject: string;
  html: string;
  studioId?: string | null;
  entityType?: string;
  // The real ID of the thing this email is about (a Payment/Order/Appointment
  // id, or a synthetic-but-real key like `${studioId}:${periodEndISODate}` for
  // recurring checks). Together with `template` + `to`, this is what makes a
  // resend of the same event a no-op instead of a duplicate email — see the
  // unique constraint on NotificationLog.
  entityId: string;
}

/**
 * The thin orchestration layer described in the design spec (Section 30):
 * given an already-rendered subject/html (from notifications/templates/*,
 * which are pure functions — no DB access), this resolves whether the event
 * was already notified, hands the send off to the existing email queue, and
 * records the outcome. Templates decide WHAT the email says; this decides
 * WHETHER and records THAT it was sent.
 *
 * A send failure here is always swallowed (logged, not thrown) — a booking or
 * payment is a real event that already happened by the time we try to notify
 * about it, and email delivery trouble must never roll that back. See
 * notifications/README.md.
 */
export class NotificationService extends Connection {
  public async send(args: SendNotificationArgs): Promise<void> {
    const existing = await this.notificationLog.findUnique({
      where: {
        template_entityId_recipient: {
          template: args.template,
          entityId: args.entityId,
          recipient: args.to,
        },
      },
    });
    if (existing) return; // already notified for this exact event — no-op

    const queued = Boolean(emailQueue);
    const log = await this.notificationLog.create({
      data: {
        studioId: args.studioId ?? null,
        template: args.template,
        recipient: args.to,
        entityType: args.entityType ?? null,
        entityId: args.entityId,
        status: "QUEUED",
      },
    });

    try {
      if (emailQueue) {
        await emailQueue.add("send", { to: args.to, subject: args.subject, html: args.html });
        // Stays "QUEUED" — the worker does the actual send; we don't have a
        // "delivered" signal without Plunk webhooks (documented as a
        // follow-up in notifications/README.md).
      } else {
        await sendEmailNow({ to: args.to, subject: args.subject, html: args.html });
        await this.notificationLog.update({
          where: { id: log.id },
          data: { status: "SENT", sentAt: new Date() },
        });
      }
    } catch (error) {
      await this.notificationLog.update({
        where: { id: log.id },
        data: {
          status: "FAILED",
          error: error instanceof Error ? error.message : "unknown error",
        },
      });
      console.error(
        `Notification ${args.template} to ${args.to} (${args.entityType ?? "?"}:${args.entityId}) ${queued ? "failed to enqueue" : "failed to send"}:`,
        error,
      );
    }
  }
}
