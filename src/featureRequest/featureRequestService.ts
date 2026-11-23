import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import { HttpCode } from "../models/status_codes";
import { NotificationService } from "../notifications/notificationService";
import { NotificationTemplate } from "../notifications/registry";
import {
  featureRequestSubmitted,
  featureRequestStatusChanged,
  featureRequestFeeSet,
} from "../notifications/templates/featureRequest";
import { addExtraCharge, waiveExtraCharge } from "../billing/extraCharges";
import { notifyStudioAdmins } from "../push/pushService";
import { platformBrand } from "../notifications/brand";
import { env } from "../config/env.config";
import { S3BucketService } from "../bucket/s3BucketService";
import { platformBrandForPlan } from "../notifications/brand";
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
  private s3 = new S3BucketService();

  /** Zuri, Zuri Studios or Zuri Stores, to match the studio being written to. */
  private async brandFor(studioId: string) {
    const studio = await runAsSuperAdmin(() =>
      this.studio.findUnique({
        where: { id: studioId },
        select: { plan: true },
      }),
    ).catch(() => null);
    return platformBrandForPlan(studio?.plan);
  }

  /** Image addresses ready to show. */
  private shown<T extends { images?: string[] }>(r: T): T {
    return {
      ...r,
      images: (r.images ?? []).map((u) => this.s3.deliveryUrl(u) ?? u),
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
    input: { title?: unknown; description?: unknown; images?: unknown },
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

    // Up to 5 pictures, each one this studio uploaded for requests.
    const rawImages = Array.isArray(input.images) ? input.images : [];
    if (rawImages.length > 5)
      throw new ApiError("Attach up to 5 images", HttpCode.BAD_REQUEST);
    const images = rawImages.map((u) =>
      this.s3.assertOwnedMediaUrl(String(u), "requests"),
    );

    const created = await this.featureRequest.create({
      data: {
        studioId: id,
        images,
        ...(userId ? { createdByUserId: userId } : {}),
        title,
        description,
      },
    });
    await this.notifySuperAdmins(
      created.id,
      id,
      title,
      images.length
        ? `${description}\n\n(${images.length} image${images.length === 1 ? "" : "s"} attached. See them on the review page.)`
        : description,
      userId,
    );
    return { message: "Feature request submitted", data: this.shown(created) };
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

      const { subject, html } = featureRequestSubmitted(platformBrand, {
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
    return {
      message: "Feature requests",
      data: requests.map((r) => this.shown(r)),
    };
  }

  // ---- Platform (super-admin) side --------------------------------------

  public async listAll(status?: string) {
    const where =
      status &&
      FEATURE_REQUEST_STATUSES.includes(status as FeatureRequestStatus)
        ? { status: status as FeatureRequestStatus }
        : {};
    const requests = await this.featureRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { studio: { select: { id: true, name: true, slug: true } } },
    });
    return {
      message: "Feature requests",
      data: requests.map((r) => this.shown(r)),
    };
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
      const { subject, html } = featureRequestStatusChanged(
        await this.brandFor(studioId),
        {
          title,
          status,
          dashboardUrl: await this.linkToStudio(
            "/admin/feature-requests",
            studioId,
          ),
        },
      );
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

  /**
   * The super admin decides what building this costs (0 = free). The fee is
   * added to the studio's next renewal, and the studio is told now.
   */
  public async setFee(id: string, rawAmount: unknown) {
    const amount = Math.round(Number(rawAmount) * 100) / 100;
    if (!Number.isFinite(amount) || amount < 0 || amount > 100000) {
      throw new ApiError(
        "Enter a fee between 0 and 100,000",
        HttpCode.BAD_REQUEST,
      );
    }
    const existing = await this.featureRequest.findUnique({ where: { id } });
    if (!existing)
      throw new ApiError("Feature request not found", HttpCode.NOT_FOUND);
    if (existing.status === "DONE" || existing.status === "DECLINED") {
      throw new ApiError(
        "This request is closed, so its fee can't change",
        HttpCode.BAD_REQUEST,
      );
    }
    const updated = await this.featureRequest.update({
      where: { id },
      data: { feeAmount: amount, feeSetAt: new Date() },
      include: { studio: { select: { id: true, name: true, slug: true } } },
    });
    await addExtraCharge({
      studioId: existing.studioId,
      kind: "FEATURE_REQUEST",
      refId: id,
      description: `Feature request: ${existing.title}`,
      amount,
    });
    await this.notifyStudioOfFee(
      updated.id,
      updated.studioId,
      updated.title,
      amount,
    );
    return { message: "Fee set. The studio has been told.", data: updated };
  }

  // Best-effort, like the other notices: email plus a push to the studio's admins.
  private async notifyStudioOfFee(
    requestId: string,
    studioId: string,
    title: string,
    amount: number,
  ) {
    try {
      const to = await this.studioNotifyEmail(studioId);
      const dashboardUrl = await this.linkToStudio(
        "/admin/feature-requests",
        studioId,
      );
      if (to) {
        const { subject, html } = featureRequestFeeSet(
          await this.brandFor(studioId),
          { title, amount, dashboardUrl },
        );
        await this.notifications.send({
          template: NotificationTemplate.FEATURE_REQUEST_FEE_STUDIO,
          to,
          subject,
          html,
          studioId,
          entityType: "FeatureRequest",
          // The amount is part of the key so a changed fee is told again.
          entityId: `${requestId}:fee:${amount}`,
        });
      }
      await notifyStudioAdmins(
        studioId,
        {
          template: "FEATURE_REQUEST_FEE_PUSH",
          entityId: `${requestId}:fee:${amount}`,
          entityType: "FeatureRequest",
        },
        {
          title:
            amount > 0
              ? "A fee for your feature request"
              : "Your feature request is free",
          body:
            amount > 0
              ? `"${title}" will cost GHS ${amount.toFixed(2)}, added to your next renewal.`
              : `"${title}" won't cost anything.`,
          url: "/admin/feature-requests",
        },
      );
    } catch (error) {
      console.error("Feature request fee notification failed:", error);
    }
  }

  /** The studio drops a request that hasn't been started, which also drops its fee. */
  public async withdraw(studioId: string | null | undefined, id: string) {
    const sid = this.requireStudioId(studioId);
    const existing = await this.featureRequest.findUnique({ where: { id } });
    if (!existing || existing.studioId !== sid)
      throw new ApiError("Feature request not found", HttpCode.NOT_FOUND);
    if (existing.status === "IN_PROGRESS" || existing.status === "DONE") {
      throw new ApiError(
        "Work on this has started, so it can't be withdrawn",
        HttpCode.BAD_REQUEST,
      );
    }
    const updated = await this.featureRequest.update({
      where: { id },
      data: { status: "DECLINED" },
    });
    await waiveExtraCharge(sid, "FEATURE_REQUEST", id);
    return {
      message: "Request withdrawn. Any fee has been removed.",
      data: updated,
    };
  }

  public async updateStatus(id: string, status: string) {
    if (!FEATURE_REQUEST_STATUSES.includes(status as FeatureRequestStatus)) {
      throw new ApiError("Invalid status", HttpCode.BAD_REQUEST);
    }
    const existing = await this.featureRequest.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError("Feature request not found", HttpCode.NOT_FOUND);
    }
    // Declined by the platform: no fee for something that won't be built.
    if (status === "DECLINED")
      await waiveExtraCharge(existing.studioId, "FEATURE_REQUEST", id);
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
