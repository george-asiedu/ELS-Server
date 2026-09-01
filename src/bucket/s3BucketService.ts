import { 
  S3Client, 
  PutObjectCommand, 
  DeleteObjectCommand 
} from '@aws-sdk/client-s3';
import { env } from '../config/env.config';
import { ApiError } from '../middleware/apiError';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { processImage, ImageProcessOptions } from './imageProcessor';
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
  
  public async uploadFile(file: SafeFile, opts?: ImageProcessOptions) {
    if (!file) {
      throw new ApiError('File is required', 400);
    }

    // Optimise photos for the web (auto-orient + downscale + WebP) while keeping
    // them sharp; non-images pass through unchanged.
    const processed = await processImage(file, opts);

    const bucketName = env.aws.s3BucketName;
    const fileExtension = path.extname(processed.originalname);
    if (!fileExtension) {
      throw new ApiError('File must have an extension', 400);
    }

    const cleanFileName = processed.originalname.replace(/\s+/g, '-');
    // Group uploads per studio so each tenant's media is separable in S3.
    const studioId = getTenantContext()?.studioId;
    const prefix = studioId ? `studios/${studioId}` : 'platform';
    const key = `${prefix}/${uuidv4()}-${cleanFileName}`;

    const params = {
      Bucket: bucketName,
      Key: key,
      Body: processed.buffer,
      ContentType: processed.mimetype,
    };
    
    try {
      await this.s3.send(new PutObjectCommand(params));
      return `https://${bucketName}.s3.${env.aws.region}.amazonaws.com/${key}`
    } catch (error) {
      throw new ApiError('Failed to upload file', 500);
    }
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