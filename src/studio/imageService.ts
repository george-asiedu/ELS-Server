import { Connection } from "../db/dbConnection";
import { env } from "../config/env.config";
import { ApiError } from "../middleware/apiError";
import { HttpCode } from "../models/status_codes";
import { S3BucketService } from "../bucket/s3BucketService";
import { processImage } from "../bucket/imageProcessor";

// Where a picture is for decides its shape and which media folder it goes in
// (so it passes the same ownership checks as an upload).
const PURPOSES = {
  hero: {
    category: "studio",
    size: "1536x1024",
    hint: "a wide website banner photo",
  },
  gallery: {
    category: "gallery",
    size: "1024x1024",
    hint: "a photo for a portfolio gallery",
  },
  product: {
    category: "products",
    size: "1024x1024",
    hint: "a clean product photo on a simple background",
  },
  service: {
    category: "services",
    size: "1536x1024",
    hint: "a photo showing this service",
  },
} as const;
type Purpose = keyof typeof PURPOSES;

const STYLES = {
  natural: "natural light, realistic, warm and inviting",
  bright: "bright, clean, airy, soft white tones",
  bold: "rich colour, dramatic lighting, high contrast, editorial",
  minimal: "minimal, calm, plenty of empty space, muted tones",
} as const;
type Style = keyof typeof STYLES;

const MAX_PROMPT = 400;

const monthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
};

/**
 * The image maker: an owner describes a picture and we make it with OpenAI's
 * image API, store it in the studio's media and keep a record (which is also
 * the monthly limit). Hidden when OPENAI_API_KEY isn't set.
 */
export class ImageService extends Connection {
  private s3 = new S3BucketService();

  private async used(studioId: string) {
    return this.generatedImage.count({
      where: { studioId, createdAt: { gte: monthStart() } },
    });
  }

  public async list(studioId: string) {
    const [images, used] = await Promise.all([
      this.generatedImage.findMany({
        where: { studioId },
        orderBy: { createdAt: "desc" },
        take: 48,
        select: {
          id: true,
          prompt: true,
          purpose: true,
          url: true,
          createdAt: true,
        },
      }),
      this.used(studioId),
    ]);
    return {
      message: "Images retrieved",
      data: {
        enabled: !!env.openai.apiKey,
        used,
        limit: env.openai.imagesPerMonth,
        images: images.map((i) => ({ ...i, url: this.s3.deliveryUrl(i.url) })),
      },
    };
  }

  public async generate(
    studioId: string,
    input: { prompt?: unknown; purpose?: unknown; style?: unknown },
  ) {
    if (!env.openai.apiKey)
      throw new ApiError(
        "The image maker isn't available yet.",
        HttpCode.BAD_REQUEST,
      );
    const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
    if (prompt.length < 3)
      throw new ApiError(
        "Describe the picture you'd like.",
        HttpCode.BAD_REQUEST,
      );
    if (prompt.length > MAX_PROMPT)
      throw new ApiError(
        `Keep the description under ${MAX_PROMPT} characters.`,
        HttpCode.BAD_REQUEST,
      );
    const purpose: Purpose =
      typeof input.purpose === "string" && input.purpose in PURPOSES
        ? (input.purpose as Purpose)
        : "gallery";
    const style: Style =
      typeof input.style === "string" && input.style in STYLES
        ? (input.style as Style)
        : "natural";

    if ((await this.used(studioId)) >= env.openai.imagesPerMonth)
      throw new ApiError(
        `You've made ${env.openai.imagesPerMonth} pictures this month. You can make more next month.`,
        HttpCode.BAD_REQUEST,
      );

    const studio = await this.studio.findUnique({
      where: { id: studioId },
      select: { name: true },
    });
    const p = PURPOSES[purpose];
    const fullPrompt = [
      `${prompt}.`,
      `This is ${p.hint} for the website of ${studio?.name ?? "a small business"} in Ghana.`,
      `Style: ${STYLES[style]}. Professional photography, sharp focus.`,
      "Where people appear, show Black African people with natural, realistic skin.",
      "No text, words, letters, logos or watermarks anywhere in the image.",
    ].join(" ");

    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.openai.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.openai.imageModel,
        prompt: fullPrompt,
        size: p.size,
        quality: "medium",
        n: 1,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const body = (await res.json().catch(() => null)) as {
      data?: { b64_json?: string }[];
      error?: { message?: string; code?: string };
    } | null;
    if (!res.ok || !body?.data?.[0]?.b64_json) {
      console.error("Image generation failed", res.status, body?.error);
      throw new ApiError(
        body?.error?.code === "moderation_blocked"
          ? "That description can't be used. Try describing it differently."
          : "We couldn't make that picture. Please try again.",
        HttpCode.BAD_REQUEST,
      );
    }

    const processed = await processImage(
      {
        originalname: "image.png",
        mimetype: "image/png",
        buffer: Buffer.from(body.data[0].b64_json, "base64"),
      },
      { maxDim: 1600, quality: 85 },
    );
    const url = await this.s3.putStudioImage(processed.buffer, p.category);
    const image = await this.generatedImage.create({
      data: { studioId, prompt, purpose, url },
      select: {
        id: true,
        prompt: true,
        purpose: true,
        url: true,
        createdAt: true,
      },
    });
    return { message: "Picture made", data: image };
  }
}
