import { 
  S3Client, 
  PutObjectCommand, 
  DeleteObjectCommand 
} from '@aws-sdk/client-s3';
import { env } from '../config/env.config';
import { ApiError } from '../middleware/apiError';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

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
  
  public async uploadFile(file: SafeFile) {
    if (!file) {
      throw new ApiError('File is required', 400);
    }
    
    const bucketName = env.aws.s3BucketName;
    const fileExtension = path.extname(file.originalname);
    if (!fileExtension) {
      throw new ApiError('File must have an extension', 400);
    }
    
    const cleanFileName = file.originalname.replace(/\s+/g, '-');
    const key = `uploads/${uuidv4()}-${cleanFileName}`;
    
    const params = {
      Bucket: bucketName,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    };
    
    try {
      await this.s3.send(new PutObjectCommand(params));
      return {
        url: `https://${bucketName}.s3.${env.aws.region}.amazonaws.com/${key}`,
        key
      }
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