import { Connection } from "../db/dbConnection";
import { runAsSuperAdmin } from "../tenant/context";
import { NotificationService } from "../notifications/notificationService";
import { NotificationTemplate } from "../notifications/registry";
import {
  brandFromStudio,
  firstName,
  storefrontFallbackBrand,
} from "../notifications/brand";
import { reviewRequest } from "../notifications/templates/review";
import { studioLink } from "../utils/studioLink";

// Review requests: a day after a completed visit, and a few days after a shop
// order was handed over, the customer is asked (email + push) for a review.
// Only customers with an account can review, and only when the studio has
// reviews switched on. Each booking or order is asked about once.

const DAY = 24 * 60 * 60 * 1000;

export class ReviewRequestService extends Connection {
  private notifications = new NotificationService();

  public async sendDue(now = new Date()) {
    return runAsSuperAdmin(async () => {
      const result = { bookings: 0, orders: 0, errors: [] as string[] };
      const reviewsOn = new Set(
        (
          await this.studioSettings.findMany({
            where: { reviews: true },
            select: { studioId: true },
          })
        ).map((s) => s.studioId),
      );

      // Visits that were completed, held 1 to 7 days ago, not yet reviewed.
      const appointments = await this.appointment.findMany({
        where: {
          status: "COMPLETED",
          userId: { not: null },
          appointmentDate: {
            gte: new Date(now.getTime() - 8 * DAY),
            lte: new Date(now.getTime() - DAY),
          },
          reviews: { none: {} },
        },
        include: {
          service: { select: { id: true, name: true } },
          user: { select: { email: true } },
        },
        take: 500,
      });
      for (const a of appointments) {
        if (!a.studioId || !reviewsOn.has(a.studioId)) continue;
        const email = a.email ?? a.user?.email;
        if (!email) continue;
        try {
          const studio = await this.currentStudioBranding(a.studioId);
          if (!studio) continue;
          const path = `/review?appointment=${a.id}${a.service ? `&service=${a.service.id}` : ""}`;
          const { subject, html } = reviewRequest(
            brandFromStudio(studio, storefrontFallbackBrand),
            {
              customerFirstName: firstName(a.fullName),
              studioName: studio.name,
              what: `your ${a.service?.name ?? "visit"}`,
              reviewUrl: studioLink(studio.slug, path),
            },
          );
          await this.notifications.send({
            template: NotificationTemplate.REVIEW_REQUEST,
            to: email,
            subject,
            html,
            studioId: a.studioId,
            entityType: "Appointment",
            entityId: `review:${a.id}`,
            pushBody: `How was your ${a.service?.name ?? "visit"}? Leave a quick review.`,
            pushUrl: path,
          });
          result.bookings++;
        } catch (e) {
          result.errors.push(`${a.id}: ${(e as Error).message}`);
        }
      }

      // Orders handed over 3 to 10 days ago: ask about the first item.
      const orders = await this.order.findMany({
        where: {
          status: "FULFILLED",
          userId: { not: null },
          updatedAt: {
            gte: new Date(now.getTime() - 10 * DAY),
            lte: new Date(now.getTime() - 3 * DAY),
          },
        },
        include: {
          items: { select: { productId: true, name: true }, take: 1 },
          user: { select: { email: true } },
        },
        take: 500,
      });
      for (const o of orders) {
        if (!o.studioId || !reviewsOn.has(o.studioId)) continue;
        const item = o.items[0];
        const email = o.customerEmail ?? o.user?.email;
        if (!item?.productId || !email) continue;
        // Already reviewed it.
        if (
          await this.review.findFirst({
            where: { userId: o.userId!, productId: item.productId },
            select: { id: true },
          })
        )
          continue;
        try {
          const studio = await this.currentStudioBranding(o.studioId);
          if (!studio) continue;
          const path = `/shop/${item.productId}#description`;
          const { subject, html } = reviewRequest(
            brandFromStudio(studio, storefrontFallbackBrand),
            {
              customerFirstName: firstName(o.customerName ?? "there"),
              studioName: studio.name,
              what: item.name,
              reviewUrl: studioLink(studio.slug, path),
            },
          );
          await this.notifications.send({
            template: NotificationTemplate.REVIEW_REQUEST,
            to: email,
            subject,
            html,
            studioId: o.studioId,
            entityType: "Order",
            entityId: `review:${o.id}`,
            pushBody: `How are you finding your ${item.name}? Leave a quick review.`,
            pushUrl: path,
          });
          result.orders++;
        } catch (e) {
          result.errors.push(`${o.id}: ${(e as Error).message}`);
        }
      }
      return result;
    });
  }
}
