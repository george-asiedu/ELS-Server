import sharp from "sharp";
import type { SafeFile } from "./s3BucketService";
import { ApiError } from "../middleware/apiError";

export interface ImageProcessOptions {
  maxDim?: number; // cap on the longest edge (px)
  quality?: number; // WebP quality (1-100)
}

/**
 * Prepare an uploaded photo for fast web delivery while keeping it crisp — most
 * uploads come straight from a phone camera (large, often EXIF-rotated):
 *  - auto-orient from EXIF so portrait shots aren't sideways,
 *  - downscale to a sensible max edge (never upscales small images),
 *  - a light sharpen to restore edge detail lost in the downscale,
 *  - re-encode as WebP at high quality, stripping metadata.
 * Videos pass through. SVG is rejected because it is active content, and
 * malformed or unsupported image bytes fail closed rather than being uploaded.
 */
export const processImage = async (
  file: SafeFile,
  opts: ImageProcessOptions = {},
): Promise<SafeFile> => {
  if (!file.mimetype.startsWith("image/")) {
    return file;
  }
  if (file.mimetype === "image/svg+xml") {
    throw new ApiError("SVG uploads are not supported", 400);
  }

  const maxDim = opts.maxDim ?? 1600;
  const quality = opts.quality ?? 82;

  try {
    const image = sharp(file.buffer, { failOn: "error" });
    const metadata = await image.metadata();
    if (!metadata.format || !["jpeg", "png", "webp", "gif", "avif", "jfif", "jpg", "pjpeg"].includes(metadata.format)) {
      throw new ApiError("Unsupported image format", 400);
    }
    if (metadata.format === "gif") return file;

    const buffer = await image
      .rotate() // apply EXIF orientation, then drop it
      .resize({
        width: maxDim,
        height: maxDim,
        fit: "inside",
        withoutEnlargement: true,
      })
      .sharpen()
      .webp({ quality, effort: 4 })
      .toBuffer();

    const base = file.originalname.replace(/\.[^.]+$/, "") || "image";
    return { originalname: `${base}.webp`, mimetype: "image/webp", buffer };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("Invalid image file", 400);
  }
};
