import {
  paymentEvidenceKey,
  safeFolderName,
  sanitizedStorageKey,
  storageEnvironment,
} from './storage.service';

describe('voucher storage', () => {
  it('builds the provider-independent hierarchy from database identifiers', () => {
    expect(
      paymentEvidenceKey(
        {
          cycleId: 15,
          cycleName: 'Verano',
          duplicateCycleName: false,
          studentId: 1045,
          studentName: 'Juan Lopez',
          duplicateStudentName: false,
          sequence: 1,
        },
        'application/pdf',
      ),
    ).toBe('aristoteles/cycles/Verano/estudiantes/Juan Lopez/voucher-001.pdf');
  });

  it('adds stable ids only for ambiguous folder names', () => {
    expect(
      paymentEvidenceKey(
        {
          cycleId: 15,
          cycleName: 'Verano',
          duplicateCycleName: true,
          studentId: 1045,
          studentName: 'Juan Lopez',
          duplicateStudentName: true,
          sequence: 2,
        },
        'image/jpeg',
      ),
    ).toBe(
      'aristoteles/cycles/Verano-15/estudiantes/Juan Lopez-1045/voucher-002.jpg',
    );
  });

  it('sanitizes unsafe folder characters while retaining readable names', () => {
    expect(safeFolderName('  Verano / 2026  ')).toBe('Verano - 2026');
    expect(safeFolderName('  学校  ')).toBe('学校');
    expect(safeFolderName('...')).toBe('Sin nombre');
  });

  it('redacts identifying values while retaining the IAM-relevant key shape', () => {
    expect(
      sanitizedStorageKey(
        'aristoteles/cycles/Verano/estudiantes/Juan Lopez/voucher-001.pdf',
      ),
    ).toBe(
      'aristoteles/cycles/<cycle>/estudiantes/<student>/voucher-<sequence>',
    );
    expect(sanitizedStorageKey('payment-evidence/42/private-name.pdf')).toBe(
      'payment-evidence/<redacted>/<redacted>',
    );
    expect(sanitizedStorageKey('unexpected-secret')).toBe('<redacted>');
  });

  it('uses local storage in development and test', () => {
    expect(storageEnvironment({ NODE_ENV: 'development' })).toBe('local');
    expect(storageEnvironment({ NODE_ENV: 'test' })).toBe('local');
    expect(storageEnvironment({})).toBe('local');
  });

  it('uses S3 in production and validates its configuration', () => {
    expect(
      storageEnvironment({
        NODE_ENV: 'production',
        AWS_REGION: 'us-east-1',
        AWS_S3_BUCKET: 'school-files',
      }),
    ).toBe('s3');
    expect(() => storageEnvironment({ NODE_ENV: 'production' })).toThrow(
      /AWS_REGION and AWS_S3_BUCKET/,
    );
    expect(() => storageEnvironment({ NODE_ENV: 'staging' })).toThrow(
      /NODE_ENV must be development, test, or production/,
    );
  });
});
