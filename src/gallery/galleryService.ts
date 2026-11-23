import { Connection } from "../db/dbConnection";
import { S3BucketService } from "../bucket/s3BucketService";
import { ApiError } from "../middleware/apiError";
import {
  TRASH_DAYS,
  forgetStorage,
  keyFromUrl,
} from "../storage/storageService";
import { runAsSuperAdmin } from "../tenant/context";
import {
  CursorPage,
  cursorPageArgs,
  cursorPageResult,
} from "../utils/cursorPagination";

export class GalleryService extends Connection {
  constructor(private s3: S3BucketService) {
    super();
  }

  // Public: active items whose category is also visible (active).
  public async listActive(page: CursorPage) {
    const visible = await this.category.findMany({
      where: { active: true },
      select: { slug: true },
    });
    const slugs = visible.map((c) => c.slug);
    const images = await this.gallery.findMany({
      where: { active: true, deletedAt: null, category: { in: slugs } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...cursorPageArgs(page),
    });
    images.forEach((item) => {
      item.imageUrl = this.s3.deliveryUrl(item.imageUrl) ?? item.imageUrl;
    });
    return {
      message: "Gallery retrieved successfully",
      ...cursorPageResult(images, page),
    };
  }

  public async listAll(page: CursorPage) {
    const images = await this.gallery.findMany({
      where: { deletedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...cursorPageArgs(page),
    });
    images.forEach((item) => {
      item.imageUrl = this.s3.deliveryUrl(item.imageUrl) ?? item.imageUrl;
    });
    return {
      message: "Gallery retrieved successfully",
      ...cursorPageResult(images, page),
    };
  }

  public async create(
    title: string | undefined,
    category: string,
    imageUrl?: string,
    externalUrl?: string,
  ) {
    const categoryExists = await this.category.findFirst({
      where: { slug: category },
    });
    if (!categoryExists) {
      throw new ApiError("Selected category does not exist", 400);
    }
    let finalUrl: string;
    let mediaType: "VIDEO" | "IMAGE";
    if (externalUrl) {
      let parsed: URL;
      try {
        parsed = new URL(externalUrl);
      } catch {
        throw new ApiError("Invalid video URL", 400);
      }
      const host = parsed.hostname.toLowerCase();
      const youtubeHost =
        host === "youtube.com" ||
        host.endsWith(".youtube.com") ||
        host === "youtu.be";
      const tiktokHost = host === "tiktok.com" || host.endsWith(".tiktok.com");
      const youtubeVideo =
        host === "youtu.be"
          ? /^\/[a-zA-Z0-9_-]{6,}$/.test(parsed.pathname)
          : parsed.pathname === "/watch"
            ? /^[a-zA-Z0-9_-]{6,}$/.test(parsed.searchParams.get("v") ?? "")
            : /^\/(?:shorts|embed)\/[a-zA-Z0-9_-]{6,}/.test(parsed.pathname);
      const tiktokVideo = /\/video\/\d+(?:\/|$)/.test(parsed.pathname);
      if (
        parsed.protocol !== "https:" ||
        parsed.username ||
        parsed.password ||
        !((youtubeHost && youtubeVideo) || (tiktokHost && tiktokVideo))
      ) {
        throw new ApiError("Use a YouTube or TikTok video link", 400);
      }
      finalUrl = parsed.toString();
      mediaType = "VIDEO";
    } else {
      if (!imageUrl)
        throw new ApiError(
          "Upload a media file or provide a YouTube/TikTok link",
          400,
        );
      finalUrl = this.s3.assertOwnedMediaUrl(imageUrl, "gallery");
      mediaType = /\.(mp4|mov|webm|m4v)(?:$|\?)/i.test(imageUrl)
        ? "VIDEO"
        : "IMAGE";
    }
    const created = await this.gallery.create({
      data: {
        ...(title ? { title } : {}),
        category,
        mediaType,
        imageUrl: finalUrl,
      },
    });
    const label = mediaType === "VIDEO" ? "Video" : "Image";
    return { message: `${label} uploaded successfully`, data: created };
  }

  /**
   * Edit an item's title, category, or whether the public sees it. The media
   * itself isn't replaced here: delete and re-upload for that.
   */
  public async update(
    id: string,
    input: { title?: unknown; category?: unknown; active?: unknown },
  ) {
    const existing = await this.gallery.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError("Gallery item not found", 404);
    }
    const data: { title?: string | null; category?: string; active?: boolean } =
      {};
    if (input.title !== undefined) {
      if (input.title !== null && typeof input.title !== "string") {
        throw new ApiError("title must be text", 400);
      }
      const title = input.title?.trim() || null;
      if (title && title.length > 120) {
        throw new ApiError("Keep the title under 120 characters", 400);
      }
      data.title = title;
    }
    if (input.category !== undefined) {
      if (typeof input.category !== "string" || !input.category) {
        throw new ApiError("Choose a category", 400);
      }
      const exists = await this.category.findFirst({
        where: { slug: input.category },
      });
      if (!exists) {
        throw new ApiError("Selected category does not exist", 400);
      }
      data.category = input.category;
    }
    if (input.active !== undefined) {
      if (typeof input.active !== "boolean") {
        throw new ApiError("active must be true or false", 400);
      }
      data.active = input.active;
    }
    const updated = await this.gallery.update({ where: { id }, data });
    updated.imageUrl =
      this.s3.deliveryUrl(updated.imageUrl) ?? updated.imageUrl;
    return { message: "Gallery item updated", data: updated };
  }

  /** Delete moves the item to the trash. It stays stored (and counted) for 30 days. */
  public async remove(id: string) {
    const existing = await this.gallery.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      throw new ApiError("Image not found", 404);
    }
    await this.gallery.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        purgeAfter: new Date(Date.now() + TRASH_DAYS * 86_400_000),
      },
    });
    return {
      message: `Moved to the trash. You can restore it for ${TRASH_DAYS} days.`,
    };
  }

  public async listTrash() {
    const items = await this.gallery.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
    });
    items.forEach((item) => {
      item.imageUrl = this.s3.deliveryUrl(item.imageUrl) ?? item.imageUrl;
    });
    return { message: "Trash", data: items };
  }

  public async restore(id: string) {
    const existing = await this.gallery.findUnique({ where: { id } });
    if (!existing?.deletedAt)
      throw new ApiError("That item isn't in the trash", 404);
    // Its category may have been removed meanwhile: put it back where it can be seen.
    const category = await this.category.findFirst({
      where: { slug: existing.category },
    });
    const restored = await this.gallery.update({
      where: { id },
      data: {
        deletedAt: null,
        purgeAfter: null,
        ...(category ? {} : { active: false }),
      },
    });
    return {
      message: category
        ? "Restored."
        : "Restored, but its category no longer exists, so it's hidden until you move it.",
      data: restored,
    };
  }

  /** Delete one trashed item for good, and its file. */
  public async purge(id: string) {
    const existing = await this.gallery.findUnique({ where: { id } });
    if (!existing?.deletedAt)
      throw new ApiError("Move it to the trash first", 400);
    await this.purgeRow(existing);
    return { message: "Deleted for good." };
  }

  /** The row and the file behind it. A file shared by another item is kept. */
  private async purgeRow(item: {
    id: string;
    studioId: string | null;
    imageUrl: string;
  }) {
    const key = keyFromUrl(item.imageUrl);
    const sharedBy = key
      ? await this.gallery.count({
          where: { id: { not: item.id }, imageUrl: item.imageUrl },
        })
      : 0;
    await this.gallery.delete({ where: { id: item.id } });
    if (key && !sharedBy) {
      await this.s3
        .deleteFile(key)
        .catch((e) =>
          console.warn("Couldn't delete a stored file:", (e as Error).message),
        );
    }
    if (item.studioId) forgetStorage(item.studioId);
  }

  /** Daily: empty what's been in the trash past its time, in every studio. */
  public async purgeExpired() {
    return runAsSuperAdmin(async () => {
      const due = await this.gallery.findMany({
        where: { deletedAt: { not: null }, purgeAfter: { lte: new Date() } },
        take: 500,
      });
      for (const item of due) await this.purgeRow(item);
      return { purged: due.length };
    });
  }
}
