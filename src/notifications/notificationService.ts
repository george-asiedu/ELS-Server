import { Connection } from "../db/dbConnection";
import { emailQueue } from "../queue/queues";
import { sendEmailNow } from "../email/emailService";
import { NotificationTemplateKey } from "./registry";
import type { EmailAttachment } from "../email/emailService";
import { PUSH_FIRST, pushForNotification } from "../push/pushService";
import { runAsSuperAdmin } from "../tenant/context";
import { zuriNameForPlan } from "./brand";

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
  // Files to attach (a receipt PDF). Passed straight through to the transport,
  // and persisted in the queue job when a queue is configured.
  attachments?: EmailAttachment[];
  // The push that goes with this email says this instead of the subject
  // (e.g. "Your report is in your email").
  pushBody?: string;
  // Where tapping the push opens, when it should be a particular page.
  pushUrl?: string;
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
// Mail from Zuri to a business (not from a business to its customers): these go
// out under Zuri's name, the one that fits the business's product.
const FROM_ZURI = new Set<string>([
  "STUDIO_CREATED",
  "STUDIO_ACCOUNT_SUSPENDED",
  "STUDIO_MONTHLY_REPORT",
  "SUBSCRIPTION_EXPIRING_SOON",
  "SUBSCRIPTION_EXPIRED",
  "FEATURE_REQUEST_SUBMITTED_PLATFORM",
  "TRAINING_REQUEST_SUBMITTED_PLATFORM",
  "FEATURE_REQUEST_STATUS_STUDIO",
  "FEATURE_REQUEST_FEE_STUDIO",
  // Heads-ups to the business about its own customers.
  "INSIGHTS_WEEKLY",
  "BOOKING_REQUEST_STUDIO",
  "BOOKING_RESCHEDULE_REQUESTED",
]);
const senderCache = new Map<
  string,
  { at: number; value: { fromName: string; replyTo?: string } }
>();

export class NotificationService extends Connection {
  /**
   * Who the email is from. A business's customers see the business's own name,
   * so they know where it comes from, and replies go to the business. Mail
   * from the platform says Zuri, Zuri Studios or Zuri Stores to match.
   */
  private async senderFor(
    args: SendNotificationArgs,
  ): Promise<{ fromName: string; replyTo?: string }> {
    const key = `${args.studioId ?? "-"}:${FROM_ZURI.has(args.template) ? "z" : "s"}`;
    const hit = senderCache.get(key);
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.value;
    let value: { fromName: string; replyTo?: string } = { fromName: "Zuri" };
    if (args.studioId) {
      const studio = await runAsSuperAdmin(() =>
        this.studio.findUnique({
          where: { id: args.studioId! },
          select: { name: true, plan: true },
        }),
      ).catch(() => null);
      if (studio) {
        if (FROM_ZURI.has(args.template))
          value = { fromName: zuriNameForPlan(studio.plan) };
        else {
          const contact = await runAsSuperAdmin(() =>
            this.contactInfo.findFirst({
              where: { studioId: args.studioId! },
              select: { email: true },
            }),
          ).catch(() => null);
          value = {
            fromName: studio.name,
            ...(contact?.email ? { replyTo: contact.email } : {}),
          };
        }
      }
    }
    senderCache.set(key, { at: Date.now(), value });
    return value;
  }

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
    let log: { id: string };
    try {
      log = await this.notificationLog.create({
        data: {
          studioId: args.studioId ?? null,
          template: args.template,
          recipient: args.to,
          entityType: args.entityType ?? null,
          entityId: args.entityId,
          status: "QUEUED",
        },
        select: { id: true },
      });
    } catch (error) {
      // A concurrent send for the same event won the unique constraint
      // between the lookup above and this insert — it's sending, so this is
      // the same no-op as finding it already logged.
      if ((error as { code?: string }).code === "P2002") return;
      throw error;
    }

    // Reminders go to the recipient's devices first; the email is only the
    // fallback for someone with no device switched on.
    if (PUSH_FIRST.has(args.template)) {
      const pushed = await pushForNotification({
        ...args,
        waitForDevices: true,
      });
      if (pushed > 0) {
        await this.notificationLog.update({
          where: { id: log.id },
          data: { status: "PUSHED", sentAt: new Date() },
        });
        return;
      }
    } else {
      // Everything else: the email, plus the same event as a push. Not awaited
      // and never throws, so it can't hold up or break the email.
      void pushForNotification(args);
    }

    const sender = await this.senderFor(args);
    const payload = {
      ...sender,
      to: args.to,
      subject: args.subject,
      html: args.html,
      ...(args.attachments?.length ? { attachments: args.attachments } : {}),
    };
    const sendInline = async () => {
      await sendEmailNow(payload);
      await this.notificationLog.update({
        where: { id: log.id },
        data: { status: "SENT", sentAt: new Date() },
      });
    };
    try {
      if (emailQueue) {
        // BullMQ waits forever while Redis is unreachable, which would hang
        // the request (e.g. the signup email code). Give the enqueue a few
        // seconds, then send the email directly instead.
        const enqueued = await Promise.race([
          emailQueue.add("send", payload).then(() => true),
          new Promise<false>((resolve) => setTimeout(resolve, 3000, false)),
        ]);
        if (!enqueued) {
          console.error("Email queue unreachable — sending inline instead.");
          await sendInline();
        }
        // Otherwise stays "QUEUED" — the worker does the actual send; we don't
        // have a "delivered" signal without Plunk webhooks (documented as a
        // follow-up in notifications/README.md).
      } else {
        await sendInline();
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
