import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import { HttpCode } from "../models/status_codes";
import { getPasswordHash, loginToken } from "../utils/helper";
import { forgetStudioSlug } from "../tenant/studioResolver";
import { paystack } from "../payment/paystackClient";

// Slugs that can never belong to a studio: they collide with platform routes,
// reserved subdomains, or the super-admin surface.
const RESERVED_SLUGS = new Set([
  "platform",
  "admin",
  "api",
  "www",
  "app",
  "dashboard",
  "login",
  "signup",
  "static",
  "assets",
]);

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export interface StudioSettingsInput {
  commerce?: boolean;
  loyalty?: boolean;
  referrals?: boolean;
  reviews?: boolean;
  gallery?: boolean;
  onlinePayments?: boolean;
  productsInBooking?: boolean;
}

export interface ProvisionStudioInput {
  name: string;
  slug: string;
  ownerEmail: string;
  ownerPassword: string;
  ownerFullName?: string;
  customDomain?: string;
  settings?: StudioSettingsInput;
}

type StudioStatus = "ACTIVE" | "SUSPENDED" | "TRIAL";

const normalizeSlug = (raw: string) =>
  String(raw ?? "").trim().toLowerCase();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Super-admin operations that span studios. Every method here runs inside the
 * platform (superAdmin) tenant context, so the tenant extension is bypassed and
 * studioId must be set explicitly on the documents we create.
 */
export class PlatformService extends Connection {
  // ---- Listing / detail -------------------------------------------------

  public async listStudios() {
    const studios = await this.studio.findMany({
      orderBy: { createdAt: "desc" },
      include: { settings: true },
    });

    // Owner emails in one query.
    const ownerIds = studios
      .map((s) => s.ownerUserId)
      .filter((id): id is string => Boolean(id));
    const owners = ownerIds.length
      ? await this.user.findMany({
          where: { id: { in: ownerIds } },
          select: { id: true, email: true },
        })
      : [];
    const ownerEmailById = new Map(owners.map((o) => [o.id, o.email]));

    // Per-studio member + booking counts (unscoped groupBy under superAdmin).
    const userCounts = await this.user.groupBy({
      by: ["studioId"],
      _count: { _all: true },
    });
    const apptCounts = await this.appointment.groupBy({
      by: ["studioId"],
      _count: { _all: true },
    });
    const countBy = (
      rows: Array<{ studioId: string | null; _count: { _all: number } }>,
    ) => {
      const m = new Map<string, number>();
      for (const r of rows) if (r.studioId) m.set(r.studioId, r._count._all);
      return m;
    };
    const usersByStudio = countBy(userCounts);
    const apptsByStudio = countBy(apptCounts);

    return studios.map((s) => ({
      id: s.id,
      name: s.name,
      slug: s.slug,
      status: s.status,
      customDomain: s.customDomain,
      ownerEmail: s.ownerUserId
        ? ownerEmailById.get(s.ownerUserId) ?? null
        : null,
      userCount: usersByStudio.get(s.id) ?? 0,
      appointmentCount: apptsByStudio.get(s.id) ?? 0,
      settings: s.settings,
      createdAt: s.createdAt,
    }));
  }

  public async getStudio(id: string) {
    const studio = await this.studio.findUnique({
      where: { id },
      include: { settings: true, branding: true, content: true },
    });
    if (!studio) {
      throw new ApiError("Studio not found", HttpCode.NOT_FOUND);
    }

    const owner = studio.ownerUserId
      ? await this.user.findUnique({
          where: { id: studio.ownerUserId },
          select: { id: true, email: true, role: true },
        })
      : null;

    const [userCount, appointmentCount, serviceCount, orderCount] =
      await Promise.all([
        this.user.count({ where: { studioId: id } }),
        this.appointment.count({ where: { studioId: id } }),
        this.service.count({ where: { studioId: id } }),
        this.order.count({ where: { studioId: id } }),
      ]);

    return {
      ...studio,
      owner,
      counts: { userCount, appointmentCount, serviceCount, orderCount },
    };
  }

  // ---- Provisioning -----------------------------------------------------

  public async provisionStudio(input: ProvisionStudioInput) {
    const name = String(input.name ?? "").trim();
    if (name.length < 2 || name.length > 60) {
      throw new ApiError("Studio name must be 2-60 characters", HttpCode.BAD_REQUEST);
    }

    const slug = normalizeSlug(input.slug);
    if (!SLUG_RE.test(slug) || slug.length < 2 || slug.length > 40) {
      throw new ApiError(
        "Slug must be 2-40 chars: lowercase letters, numbers and hyphens",
        HttpCode.BAD_REQUEST,
      );
    }
    if (RESERVED_SLUGS.has(slug)) {
      throw new ApiError("That slug is reserved", HttpCode.BAD_REQUEST);
    }

    const ownerEmail = String(input.ownerEmail ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(ownerEmail)) {
      throw new ApiError("A valid owner email is required", HttpCode.BAD_REQUEST);
    }
    const ownerPassword = String(input.ownerPassword ?? "");
    if (ownerPassword.length < 8) {
      throw new ApiError(
        "Owner password must be at least 8 characters",
        HttpCode.BAD_REQUEST,
      );
    }

    // Slug uniqueness (globally unique in the schema).
    const slugTaken = await this.studio.findUnique({ where: { slug } });
    if (slugTaken) {
      throw new ApiError("A studio with that slug already exists", HttpCode.CONFLICT);
    }

    // Custom domain uniqueness is enforced here (the column can't be @unique in
    // Mongo because multiple nulls would collide).
    const customDomain = input.customDomain?.trim().toLowerCase() || undefined;
    if (customDomain) {
      const domainTaken = await this.studio.findFirst({ where: { customDomain } });
      if (domainTaken) {
        throw new ApiError("That custom domain is already in use", HttpCode.CONFLICT);
      }
    }

    // 1. The studio itself.
    const studio = await this.studio.create({
      data: {
        name,
        slug,
        status: "ACTIVE",
        ...(customDomain ? { customDomain } : {}),
      },
    });

    // 2. Owner ADMIN user (studioId stamped explicitly — extension is bypassed
    //    under superAdmin context).
    const hashedPassword = await getPasswordHash(ownerPassword);
    const owner = await this.user.create({
      data: {
        email: ownerEmail,
        password: hashedPassword,
        role: "ADMIN",
        studioId: studio.id,
      },
    });

    const ownerFullName = input.ownerFullName?.trim();
    await this.profile.create({
      data: {
        userId: owner.id,
        email: ownerEmail,
        studioId: studio.id,
        ...(ownerFullName ? { fullName: ownerFullName } : {}),
      },
    });

    // 3. Point the studio at its owner.
    await this.studio.update({
      where: { id: studio.id },
      data: { ownerUserId: owner.id },
    });

    // 4. Feature flags, branding + content shells.
    const s = input.settings ?? {};
    await this.studioSettings.create({
      data: {
        studioId: studio.id,
        commerce: s.commerce ?? false,
        loyalty: s.loyalty ?? true,
        referrals: s.referrals ?? true,
        reviews: s.reviews ?? true,
        gallery: s.gallery ?? true,
        onlinePayments: s.onlinePayments ?? false,
        productsInBooking: s.productsInBooking ?? false,
      },
    });
    await this.studioBranding.create({ data: { studioId: studio.id } });
    await this.studioContent.create({
      data: {
        studioId: studio.id,
        heroHeadline: name,
        showTestimonials: true,
      },
    });

    return this.getStudio(studio.id);
  }

  // ---- Mutations --------------------------------------------------------

  public async updateStudio(
    id: string,
    data: {
      name?: string;
      customDomain?: string | null;
      platformFeePercent?: number;
    },
  ) {
    const studio = await this.studio.findUnique({ where: { id } });
    if (!studio) throw new ApiError("Studio not found", HttpCode.NOT_FOUND);

    const patch: {
      name?: string;
      customDomain?: string | null;
      platformFeePercent?: number;
    } = {};

    if (data.platformFeePercent !== undefined) {
      const pct = Number(data.platformFeePercent);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        throw new ApiError("Fee must be between 0 and 100", HttpCode.BAD_REQUEST);
      }
      patch.platformFeePercent = pct;
      // Keep Paystack in sync when the studio already has a subaccount.
      if (studio.paystackSubaccountCode) {
        try {
          await paystack.updateSubaccount(studio.paystackSubaccountCode, {
            percentageCharge: pct,
          });
        } catch (error) {
          throw new ApiError(
            error instanceof ApiError
              ? `Paystack: ${error.message}`
              : "Could not update the studio's fee on Paystack",
            HttpCode.BAD_GATEWAY,
          );
        }
      }
    }

    if (data.name !== undefined) {
      const name = String(data.name).trim();
      if (name.length < 2 || name.length > 60) {
        throw new ApiError("Studio name must be 2-60 characters", HttpCode.BAD_REQUEST);
      }
      patch.name = name;
    }

    if (data.customDomain !== undefined) {
      const domain = data.customDomain
        ? String(data.customDomain).trim().toLowerCase()
        : null;
      if (domain) {
        const taken = await this.studio.findFirst({
          where: { customDomain: domain, id: { not: id } },
        });
        if (taken) {
          throw new ApiError("That custom domain is already in use", HttpCode.CONFLICT);
        }
      }
      patch.customDomain = domain;
    }

    const updated = await this.studio.update({ where: { id }, data: patch });
    forgetStudioSlug(updated.slug);
    return this.getStudio(id);
  }

  public async setStatus(id: string, status: StudioStatus) {
    if (!["ACTIVE", "SUSPENDED", "TRIAL"].includes(status)) {
      throw new ApiError("Invalid status", HttpCode.BAD_REQUEST);
    }
    const studio = await this.studio.findUnique({ where: { id } });
    if (!studio) throw new ApiError("Studio not found", HttpCode.NOT_FOUND);

    await this.studio.update({ where: { id }, data: { status } });
    // Bust the resolver cache so the new status takes effect immediately.
    forgetStudioSlug(studio.slug);
    return this.getStudio(id);
  }

  public async updateSettings(id: string, settings: StudioSettingsInput) {
    const studio = await this.studio.findUnique({ where: { id } });
    if (!studio) throw new ApiError("Studio not found", HttpCode.NOT_FOUND);

    const patch = Object.fromEntries(
      Object.entries(settings).filter(
        ([k, v]) =>
          typeof v === "boolean" &&
          [
            "commerce",
            "loyalty",
            "referrals",
            "reviews",
            "gallery",
            "onlinePayments",
            "productsInBooking",
          ].includes(k),
      ),
    );

    await this.studioSettings.upsert({
      where: { studioId: id },
      update: patch,
      create: { studioId: id, ...patch },
    });
    return this.getStudio(id);
  }

  // ---- Impersonation ----------------------------------------------------

  /**
   * Mint an access token for the studio's owner so the super admin can drop into
   * that studio's admin dashboard. The frontend uses the returned slug to scope
   * subsequent requests to the studio.
   */
  public async impersonate(id: string) {
    const studio = await this.studio.findUnique({ where: { id } });
    if (!studio) throw new ApiError("Studio not found", HttpCode.NOT_FOUND);
    if (!studio.ownerUserId) {
      throw new ApiError("This studio has no owner to impersonate", HttpCode.BAD_REQUEST);
    }

    const owner = await this.user.findUnique({
      where: { id: studio.ownerUserId },
      select: { id: true, email: true, role: true, studioId: true },
    });
    if (!owner) {
      throw new ApiError("Studio owner not found", HttpCode.NOT_FOUND);
    }

    const token = loginToken({
      id: owner.id,
      email: owner.email,
      role: owner.role,
      studioId: studio.id,
    });

    return {
      token,
      studio: { id: studio.id, slug: studio.slug, name: studio.name },
      user: { id: owner.id, email: owner.email, role: owner.role },
    };
  }
}
