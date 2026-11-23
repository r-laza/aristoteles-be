import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const PAYMENT_EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;
export const PAYMENT_EVIDENCE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf',
] as const;

type StoredObject = { body: Buffer; contentType: string };
export type StorageLocation = 'local' | 's3';
export type PaymentEvidencePath = {
  cycleId: number;
  cycleName: string;
  duplicateCycleName: boolean;
  studentId: number;
  studentName: string;
  duplicateStudentName: boolean;
  sequence: number;
};

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
  private readonly logger = new Logger(S3StorageProvider.name);

  constructor() {
    const region = process.env.AWS_REGION;
    const bucket = process.env.AWS_S3_BUCKET;
    if (!region || !bucket)
      throw new Error(
        'AWS_REGION and AWS_S3_BUCKET are required when NODE_ENV=production',
      );
    this.bucket = bucket;
    this.client = new S3Client({ region });
  }

  private async execute<T>(
    operation: 'PutObject' | 'GetObject' | 'DeleteObject',
    key: string,
    action: () => Promise<T>,
  ) {
    try {
      return await action();
    } catch (error) {
      const awsError = error as {
        name?: unknown;
        Code?: unknown;
        code?: unknown;
        $metadata?: { httpStatusCode?: unknown };
      };
      this.logger.error({
        message: 'S3 voucher operation failed',
        operation,
        key: sanitizedStorageKey(key),
        errorCode: String(
          awsError.Code ?? awsError.code ?? awsError.name ?? 'UnknownError',
        ),
        httpStatus:
          typeof awsError.$metadata?.httpStatusCode === 'number'
            ? awsError.$metadata.httpStatusCode
            : undefined,
      });
      throw error;
    }
  }

  async upload(key: string, body: Buffer, contentType: string) {
    await this.execute('PutObject', key, () =>
      this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          IfNoneMatch: '*',
        }),
      ),
    );
  }

  async get(key: string) {
    const result = await this.execute('GetObject', key, () =>
      this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      ),
    );
    if (!result.Body) throw new Error('Stored object has no body');
    return {
      body: Buffer.from(await result.Body.transformToByteArray()),
      contentType: result.ContentType ?? 'application/octet-stream',
    };
  }

  async delete(key: string) {
    await this.execute('DeleteObject', key, () =>
      this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      ),
    );
  }
}

function extensionFor(mimeType: string) {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  return 'pdf';
}

export function storageEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): StorageLocation {
  const environment = (env.NODE_ENV ?? 'development').trim();
  if (environment === 'development' || environment === 'test') return 'local';
  if (environment !== 'production')
    throw new Error(
      'NODE_ENV must be development, test, or production for voucher storage',
    );
  if (!env.AWS_REGION?.trim() || !env.AWS_S3_BUCKET?.trim())
    throw new Error(
      'AWS_REGION and AWS_S3_BUCKET are required when NODE_ENV=production',
    );
  return 's3';
}

export function safeFolderName(value: string) {
  const safe = value
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .replace(/^[ .-]+|[ .-]+$/g, '')
    .slice(0, 100)
    .replace(/[ .-]+$/g, '');
  return safe || 'Sin nombre';
}

export function paymentEvidenceKey(
  pathData: PaymentEvidencePath,
  mimeType: string,
) {
  if (!Number.isSafeInteger(pathData.sequence) || pathData.sequence < 1)
    throw new Error('Voucher sequence must be a positive integer');
  const cycleFolder = `${safeFolderName(pathData.cycleName)}${
    pathData.duplicateCycleName ? `-${pathData.cycleId}` : ''
  }`;
  const studentFolder = `${safeFolderName(pathData.studentName)}${
    pathData.duplicateStudentName ? `-${pathData.studentId}` : ''
  }`;
  return [
    'aristoteles',
    'cycles',
    cycleFolder,
    'estudiantes',
    studentFolder,
    `voucher-${String(pathData.sequence).padStart(3, '0')}.${extensionFor(mimeType)}`,
  ].join('/');
}

export function sanitizedStorageKey(key: string) {
  if (
    /^aristoteles\/cycles\/[^/]+\/estudiantes\/[^/]+\/voucher-\d+\.(?:jpg|png|pdf)$/.test(
      key,
    )
  )
    return 'aristoteles/cycles/<cycle>/estudiantes/<student>/voucher-<sequence>';
  if (/^payment-evidence\/[^/]+\/[^/]+$/.test(key))
    return 'payment-evidence/<redacted>/<redacted>';
  const segments = key.split('/').filter(Boolean);
  return segments.length >= 2
    ? `${segments[0]}/${segments[1]}/<redacted>`
    : '<redacted>';
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
  readonly location: StorageLocation;
  private readonly providers = new Map<StorageLocation, StorageProvider>();

  constructor() {
    this.location = storageEnvironment();
    this.providers.set(
      this.location,
      this.location === 's3'
        ? new S3StorageProvider()
        : new LocalStorageProvider(),
    );
  }

  private provider(location: StorageLocation = this.location) {
    let provider = this.providers.get(location);
    if (!provider) {
      provider =
        location === 's3'
          ? new S3StorageProvider()
          : new LocalStorageProvider();
      this.providers.set(location, provider);
    }
    return provider;
  }

  async uploadPaymentEvidence(
    pathData: PaymentEvidencePath,
    file: Express.Multer.File,
  ) {
    if (
      !PAYMENT_EVIDENCE_MIME_TYPES.includes(
        file.mimetype as (typeof PAYMENT_EVIDENCE_MIME_TYPES)[number],
      ) ||
      !validSignature(file.buffer, file.mimetype)
    )
      throw new BadRequestException('Invalid payment evidence file');
    const key = paymentEvidenceKey(pathData, file.mimetype);
    await this.provider().upload(key, file.buffer, file.mimetype);
    return { key, location: this.location };
  }

  get(key: string, location?: StorageLocation | null) {
    return this.provider(location ?? this.location).get(key);
  }

  delete(key: string, location?: StorageLocation | null) {
    return this.provider(location ?? this.location).delete(key);
  }
}
