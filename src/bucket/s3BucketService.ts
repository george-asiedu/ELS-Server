import { 
  S3Client, 
  DeleteObjectCommand 
  ,CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, ListPartsCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env.config';
import { ApiError } from '../middleware/apiError';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getTenantContext } from '../tenant/context';

export interface SafeFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

export class S3BucketService {
  private s3: S3Client;

  constructor() {
    this.s3 = new S3Client({
      region: env.aws.region,
      credentials: {
        accessKeyId: env.aws.accessKeyId,
        secretAccessKey: env.aws.secretAccessKey,
      },
    });
  }
  
  private publicUrl(key: string) {
    if (!env.aws.cloudFrontUrl) throw new ApiError("AWS_CLOUDFRONT_URL is not configured", 500);
    return `${env.aws.cloudFrontUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
  }

  public deliveryUrl(value: string | null | undefined): string | null {
    if (!value) return null;
    try {
      const parsed = new URL(value);
      const s3Host = parsed.hostname === env.aws.s3BucketName + ".s3.amazonaws.com"
        || parsed.hostname.startsWith(env.aws.s3BucketName + ".s3.");
      if (s3Host && env.aws.cloudFrontUrl) return this.publicUrl(decodeURIComponent(parsed.pathname.replace(/^\//, "")));
    } catch { /* preserve non-URL values for existing records */ }
    return value;
  }

  public async initiateMultipart(input: { category: string; fileName: string; contentType: string; size: number }) {
    const tenant = getTenantContext();
    if (!tenant?.studioId) throw new ApiError("Studio context is required for media uploads", 400);
    if (!/^[a-z0-9_-]{1,40}$/.test(input.category)) throw new ApiError("Invalid upload category", 400);
    const ext = path.extname(input.fileName).toLowerCase();
    if (!/^\.[a-z0-9]{1,8}$/.test(ext)) throw new ApiError("File extension is required", 400);
    const videoTypes = new Set(["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"]);
    const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]);
    const isVideo = videoTypes.has(input.contentType);
    const isImage = imageTypes.has(input.contentType);
    const extensionMatches: Record<string, string[]> = {
      "image/jpeg": [".jpg", ".jpeg"], "image/png": [".png"], "image/webp": [".webp"],
      "image/avif": [".avif"], "image/gif": [".gif"], "video/mp4": [".mp4"],
      "video/quicktime": [".mov"], "video/webm": [".webm"], "video/x-m4v": [".m4v"],
    };
    if (!extensionMatches[input.contentType]?.includes(ext)) {
      throw new ApiError("The filename extension does not match its media type", 400);
    }
    if (input.category === "gallery" ? !(isImage || isVideo) : !isImage) {
      throw new ApiError(input.category === "gallery" ? "Unsupported gallery media type" : "This media category accepts images only", 400);
    }
    const maxBytes = input.category === "gallery" ? 2 * 1024 * 1024 * 1024
      : input.category === "studio" ? 4 * 1024 * 1024
      : input.category === "profiles" || input.category === "appointments" ? 10 * 1024 * 1024
      : 25 * 1024 * 1024;
    if (!Number.isSafeInteger(input.size) || input.size < 1 || input.size > maxBytes) {
      throw new ApiError(`File exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB limit for ${input.category}`, 400);
    }
    const key = `studios/${tenant.studioId}/${input.category}/${uuidv4()}${ext}`;
    const created = await this.s3.send(new CreateMultipartUploadCommand({
      Bucket: env.aws.s3BucketName, Key: key, ContentType: input.contentType,
    }));
    if (!created.UploadId) throw new ApiError("Unable to start upload", 500);
    const partSize = 10 * 1024 * 1024;
    const count = Math.ceil(input.size / partSize);
    const parts = await Promise.all(Array.from({ length: count }, async (_, i) => ({
      partNumber: i + 1,
      url: await getSignedUrl(this.s3, new UploadPartCommand({
        Bucket: env.aws.s3BucketName, Key: key, UploadId: created.UploadId, PartNumber: i + 1,
      }), { expiresIn: 3600 }),
    })));
    return { key, uploadId: created.UploadId, partSize, parts };
  }

  public async completeMultipart(key: string, uploadId: string, parts: { ETag: string; PartNumber: number }[]) {
    const studioId = getTenantContext()?.studioId;
    if (!studioId || !key.startsWith(`studios/${studioId}/`) || key.split("/").length !== 4) {
      throw new ApiError("Upload does not belong to this studio", 403);
    }
    if (!uploadId || !parts.length || parts.some((p, i) => p.PartNumber !== i + 1 || !p.ETag)) {
      throw new ApiError("Invalid multipart upload parts", 400);
    }
    const category = key.split("/")[2] ?? "";
    const maxBytes = category === "gallery" ? 2 * 1024 * 1024 * 1024
      : category === "studio" ? 4 * 1024 * 1024
      : category === "profiles" || category === "appointments" ? 10 * 1024 * 1024
      : 25 * 1024 * 1024;
    const uploadedParts = await this.s3.send(new ListPartsCommand({
      Bucket: env.aws.s3BucketName, Key: key, UploadId: uploadId,
    }));
    const actual = uploadedParts.Parts ?? [];
    const actualBytes = actual.reduce((sum, part) => sum + (part.Size ?? 0), 0);
    if (actual.length !== parts.length || actualBytes < 1 || actualBytes > maxBytes
      || actual.some((part, index) => part.PartNumber !== parts[index]?.PartNumber || part.ETag !== parts[index]?.ETag)) {
      throw new ApiError("Uploaded parts do not match the initiated media upload or exceed its size limit", 400);
    }
    await this.s3.send(new CompleteMultipartUploadCommand({
      Bucket: env.aws.s3BucketName, Key: key, UploadId: uploadId,
      MultipartUpload: { Parts: parts.map(({ ETag, PartNumber }) => ({ ETag, PartNumber })) },
    }));
    return this.publicUrl(key);
  }

  public async abortMultipart(key: string, uploadId: string) {
    const studioId = getTenantContext()?.studioId;
    if (!studioId || !key.startsWith(`studios/${studioId}/`) || key.split("/").length !== 4) {
      throw new ApiError("Upload does not belong to this studio", 403);
    }
    await this.s3.send(new AbortMultipartUploadCommand({ Bucket: env.aws.s3BucketName, Key: key, UploadId: uploadId }));
  }

  public assertOwnedMediaUrl(value: string, category: string) {
    const studioId = getTenantContext()?.studioId;
    if (!studioId || !env.aws.cloudFrontUrl) throw new ApiError("Media configuration is unavailable", 500);
    let url: URL;
    try { url = new URL(value); } catch { throw new ApiError("Invalid media URL", 400); }
    const base = new URL(env.aws.cloudFrontUrl);
    const key = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (url.origin !== base.origin || url.search || url.hash || url.username || url.password
      || key.split("/").length !== 4 || !key.startsWith(`studios/${studioId}/${category}/`)) {
      throw new ApiError("Media URL is not owned by this studio and category", 400);
    }
    return value;
  }
  
  public async deleteFile(key: string) {
    if (!key) {
      throw new ApiError('Invalid S3 key provided.', 400);
    }
    
    const bucketName = env.aws.s3BucketName;
    const params = {
      Bucket: bucketName,
      Key: key,
    };
    
    try {
      await this.s3.send(new DeleteObjectCommand(params));
    } catch (error) {
      throw new ApiError('Failed to delete file', 500);
    }
  }
}
