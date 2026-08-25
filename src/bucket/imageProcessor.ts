import sharp from "sharp";
import type { SafeFile } from "./s3BucketService";

export interface ImageProcessOptions {
  maxDim?: number; // cap on the longest edge (px)
  quality?: number; // WebP quality (1-100)
}

// Formats we don't rasterize: animated GIFs and vector SVGs are left as-is.
const SKIP = new Set(["image/gif", "image/svg+xml"]);

/**
 * Prepare an uploaded photo for fast web delivery while keeping it crisp — most
 * uploads come straight from a phone camera (large, often EXIF-rotated):
 *  - auto-orient from EXIF so portrait shots aren't sideways,
 *  - downscale to a sensible max edge (never upscales small images),
 *  - a light sharpen to restore edge detail lost in the downscale,
 *  - re-encode as WebP at high quality, stripping metadata.
 * Non-images (video) and skip-list formats pass through untouched. On any
 * failure it falls back to the original bytes so an upload never breaks.
 */
export const processImage = async (
  file: SafeFile,
  opts: ImageProcessOptions = {},
): Promise<SafeFile> => {
  if (!file.mimetype.startsWith("image/") || SKIP.has(file.mimetype)) {
    return file;
  }

  const maxDim = opts.maxDim ?? 1600;
  const quality = opts.quality ?? 82;

  try {
    const buffer = await sharp(file.buffer, { failOn: "none" })
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
  } catch {
    return file;
  }
};
