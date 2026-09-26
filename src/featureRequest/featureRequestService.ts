import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import { HttpCode } from "../models/status_codes";
import { NotificationService } from "../notifications/notificationService";
import { NotificationTemplate } from "../notifications/registry";
import {
  featureRequestSubmitted,
  featureRequestStatusChanged,
} from "../notifications/templates/featureRequest";
import { EmailBrand } from "../notifications/types";
import { env } from "../config/env.config";
import { runAsSuperAdmin } from "../tenant/context";

export const FEATURE_REQUEST_STATUSES = [
  "NEW",
  "PLANNED",
  "IN_PROGRESS",
  "DONE",
  "DECLINED",
] as const;

type FeatureRequestStatus = (typeof FEATURE_REQUEST_STATUSES)[number];

/**
 * Feature requests a studio sends to the platform operator. FeatureRequest is a
 * platform model (not auto-scoped), so studio-side queries are filtered by
 * studioId explicitly; the super-admin side sees them all.
 */
export class FeatureRequestService extends Connection {
  private notifications = new NotificationService();

  // Platform identity — feature-request mail is platform business, not studio
  // storefront business, so both directions are Zuri-branded.
  private zuriBrand(): EmailBrand {
    return {
      kind: "zuri",
      zuri: {
        name: "Zuri Studios",
        websiteUrl: env.clientUrl,
        supportEmail: env.senderEmail,
      },
    };
  }

  /**
   * Every super admin's email. User is a tenant-scoped model, so this must run
   * in the super-admin context: from a studio request the ambient scope would
   * filter to that studio and find nobody.
   */
  private async superAdminEmails(): Promise<string[]> {
    return runAsSuperAdmin(async () => {
      const admins = await this.user.findMany({
        where: { role: "SUPER_ADMIN" },
        select: { email: true },
      });
      const emails = admins.map((a) => a.email).filter(Boolean);
      // Fall back to the configured sender so a request is never silently
      // unreported if no SUPER_ADMIN row exists yet.
      return emails.length ? emails : [env.senderEmail];
    });
  }

  /** Where to reach the studio that raised a request (owner account email). */
  private async studioNotifyEmail(studioId: string): Promise<string | null> {
    return runAsSuperAdmin(async () => {
      const studio = await this.studio.findUnique({
        where: { id: studioId },
        select: { ownerUserId: true },
      });
      if (!studio?.ownerUserId) return null;
      const owner = await this.user.findUnique({
        where: { id: studio.ownerUserId },
        select: { email: true },
      });
      return owner?.email ?? null;
    });
  }

  private requireStudioId(studioId: string | null | undefined): string {
    if (!studioId) {
      throw new ApiError("Studio context missing", HttpCode.NOT_FOUND);
    }
    return studioId;
  }

  // ---- Studio side ------------------------------------------------------

  public async create(
    studioId: string | null | undefined,
    userId: string | undefined,
    input: { title?: unknown; description?: unknown },
  ) {
    const id = this.requireStudioId(studioId);
    const title = String(input.title ?? "").trim();
    const description = String(input.description ?? "").trim();

    if (title.length < 3 || title.length > 80) {
      throw new ApiError("Title must be 3-80 characters", HttpCode.BAD_REQUEST);
    }
    if (description.length < 5 || description.length > 500) {
      throw new ApiError(
        "Description must be 5-500 characters",
        HttpCode.BAD_REQUEST,
      );
    }

    const created = await this.featureRequest.create({
      data: {
        studioId: id,
        ...(userId ? { createdByUserId: userId } : {}),
        title,
        description,
      },
    });
    await this.notifySuperAdmins(created.id, id, title, description, userId);
    return { message: "Feature request submitted", data: created };
  }

  // Best-effort: a mail failure must never fail the request the studio just made.
  private async notifySuperAdmins(
    requestId: string,
    studioId: string,
    title: string,
    description: string,
    userId: string | undefined,
  ) {
    try {
      const studio = await runAsSuperAdmin(() =>
        this.studio.findUnique({
          where: { id: studioId },
          select: { name: true, slug: true },
        }),
      );
      const requestedBy = userId
        ? await runAsSuperAdmin(() =>
            this.user.findUnique({
              where: { id: userId },
              select: { email: true },
            }),
          )
        : null;

      const { subject, html } = featureRequestSubmitted(this.zuriBrand(), {
        studioName: studio?.name ?? "A studio",
        studioSlug: studio?.slug ?? studioId,
        title,
        description,
        requestedByEmail: requestedBy?.email ?? null,
        reviewUrl: `${env.clientUrl}/platform/feature-requests`,
      });

      for (const to of await this.superAdminEmails()) {
        await this.notifications.send({
          template: NotificationTemplate.FEATURE_REQUEST_SUBMITTED_PLATFORM,
          to,
          subject,
          html,
          studioId,
          entityType: "FeatureRequest",
          entityId: requestId,
        });
      }
    } catch (error) {
      console.error("Feature request notification failed:", error);
    }
  }

  public async listForStudio(studioId: string | null | undefined) {
    const id = this.requireStudioId(studioId);
    const requests = await this.featureRequest.findMany({
      where: { studioId: id },
      orderBy: { createdAt: "desc" },
    });
    return { message: "Feature requests", data: requests };
  }

  // ---- Platform (super-admin) side --------------------------------------

  public async listAll(status?: string) {
    const where =
      status && FEATURE_REQUEST_STATUSES.includes(status as FeatureRequestStatus)
        ? { status: status as FeatureRequestStatus }
        : {};
    const requests = await this.featureRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { studio: { select: { id: true, name: true, slug: true } } },
    });
    return { message: "Feature requests", data: requests };
  }

  /**
   * Tell the studio where their request stands. Best-effort.
   *
   * The notification log dedupes on (template, entityId, recipient), so the
   * entity key carries the status — otherwise only the FIRST status change
   * would ever reach the studio and every later one would be swallowed as a
   * duplicate.
   */
  private async notifyStudioOfStatus(
    requestId: string,
    studioId: string,
    title: string,
    status: string,
  ) {
    try {
      const to = await this.studioNotifyEmail(studioId);
      if (!to) return;
      const { subject, html } = featureRequestStatusChanged(this.zuriBrand(), {
        title,
        status,
        dashboardUrl: `${env.clientUrl}/admin/feature-requests`,
      });
      await this.notifications.send({
        template: NotificationTemplate.FEATURE_REQUEST_STATUS_STUDIO,
        to,
        subject,
        html,
        studioId,
        entityType: "FeatureRequest",
        entityId: `${requestId}:${status}`,
      });
    } catch (error) {
      console.error("Feature request status notification failed:", error);
    }
  }

  public async updateStatus(id: string, status: string) {
    if (!FEATURE_REQUEST_STATUSES.includes(status as FeatureRequestStatus)) {
      throw new ApiError("Invalid status", HttpCode.BAD_REQUEST);
    }
    const existing = await this.featureRequest.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError("Feature request not found", HttpCode.NOT_FOUND);
    }
    const updated = await this.featureRequest.update({
      where: { id },
      data: { status: status as FeatureRequestStatus },
      include: { studio: { select: { id: true, name: true, slug: true } } },
    });

    // Only mail on an actual transition — re-saving the same status shouldn't
    // email the studio again.
    if (existing.status !== updated.status) {
      await this.notifyStudioOfStatus(
        updated.id,
        updated.studioId,
        updated.title,
        updated.status,
      );
    }

    return { message: "Feature request updated", data: updated };
  }
}
