import { BadRequestException, Injectable } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const PAYMENT_EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;
export const PAYMENT_EVIDENCE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf',
] as const;

type StoredObject = { body: Buffer; contentType: string };

interface StorageProvider {
  upload(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject>;
  delete(key: string): Promise<void>;
}

class LocalStorageProvider implements StorageProvider {
  private readonly root = path.resolve(process.cwd(), 'uploads');

  private target(key: string) {
    const target = path.resolve(this.root, key);
    if (!target.startsWith(`${this.root}${path.sep}`))
      throw new BadRequestException('Invalid storage key');
    return target;
  }

  async upload(key: string, body: Buffer) {
    const target = this.target(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body, { flag: 'wx' });
  }

  async get(key: string, contentType = 'application/octet-stream') {
    return { body: await readFile(this.target(key)), contentType };
  }

  async delete(key: string) {
    try {
      await unlink(this.target(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

class S3StorageProvider implements StorageProvider {
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor() {
    const region = process.env.AWS_REGION;
    const bucket = process.env.AWS_S3_BUCKET;
    if (!region || !bucket)
      throw new Error('AWS_REGION and AWS_S3_BUCKET are required in prd');
    this.bucket = bucket;
    this.client = new S3Client({ region });
  }

  async upload(key: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string) {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!result.Body) throw new Error('Stored object has no body');
    return {
      body: Buffer.from(await result.Body.transformToByteArray()),
      contentType: result.ContentType ?? 'application/octet-stream',
    };
  }

  async delete(key: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}

function extensionFor(mimeType: string) {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  return 'pdf';
}

function validSignature(body: Buffer, mimeType: string) {
  if (mimeType === 'image/jpeg')
    return body.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (mimeType === 'image/png')
    return body
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return body.subarray(0, 5).toString('ascii') === '%PDF-';
}

@Injectable()
export class StorageService {
  private readonly provider: StorageProvider;

  constructor() {
    const environment = process.env.APP_ENV ?? 'local';
    if (environment !== 'local' && environment !== 'prd')
      throw new Error('APP_ENV must be local or prd');
    this.provider =
      environment === 'prd'
        ? new S3StorageProvider()
        : new LocalStorageProvider();
  }

  async uploadPaymentEvidence(paymentId: number, file: Express.Multer.File) {
    if (
      !PAYMENT_EVIDENCE_MIME_TYPES.includes(
        file.mimetype as (typeof PAYMENT_EVIDENCE_MIME_TYPES)[number],
      ) ||
      !validSignature(file.buffer, file.mimetype)
    )
      throw new BadRequestException('Invalid payment evidence file');
    const key = `payment-evidence/${paymentId}/${randomUUID()}.${extensionFor(file.mimetype)}`;
    await this.provider.upload(key, file.buffer, file.mimetype);
    return key;
  }

  get(key: string) {
    return this.provider.get(key);
  }

  delete(key: string) {
    return this.provider.delete(key);
  }
}
