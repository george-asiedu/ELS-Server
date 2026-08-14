import { Connection } from "../db/dbConnection";
import { ApiError } from "../middleware/apiError";
import { HttpCode } from "../models/status_codes";

/**
 * Public, read-only view of the current studio used by the storefront to brand
 * itself at runtime (name, logo, colors, landing content, enabled features).
 * Branding/content/settings are platform models keyed by studioId, so they're
 * queried directly by id (they aren't auto-scoped by the tenant extension).
 */
export class StudioService extends Connection {
  public async getPublicConfig(studioId: string | null | undefined) {
    if (!studioId) {
      throw new ApiError("Studio context missing", HttpCode.NOT_FOUND);
    }

    const studio = await this.studio.findUnique({
      where: { id: studioId },
      include: { branding: true, content: true, settings: true },
    });
    if (!studio) {
      throw new ApiError("Studio not found", HttpCode.NOT_FOUND);
    }

    return {
      name: studio.name,
      slug: studio.slug,
      branding: {
        logoUrl: studio.branding?.logoUrl ?? null,
        primaryColor: studio.branding?.primaryColor ?? null,
        accentColor: studio.branding?.accentColor ?? null,
        fontFamily: studio.branding?.fontFamily ?? null,
      },
      content: {
        heroHeadline: studio.content?.heroHeadline ?? null,
        heroSubtext: studio.content?.heroSubtext ?? null,
        aboutText: studio.content?.aboutText ?? null,
        featureCards: studio.content?.featureCards ?? null,
        showTestimonials: studio.content?.showTestimonials ?? true,
      },
      settings: {
        commerce: studio.settings?.commerce ?? false,
        loyalty: studio.settings?.loyalty ?? true,
        referrals: studio.settings?.referrals ?? true,
        reviews: studio.settings?.reviews ?? true,
        gallery: studio.settings?.gallery ?? true,
        onlinePayments: studio.settings?.onlinePayments ?? false,
        productsInBooking: studio.settings?.productsInBooking ?? false,
      },
    };
  }
}
