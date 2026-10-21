ALTER TYPE "PaymentMethod" ADD VALUE 'YAPE';
ALTER TYPE "PaymentMethod" ADD VALUE 'PLIN';

ALTER TABLE "Payment"
  ADD COLUMN "paymentEvidenceKey" TEXT,
  ADD COLUMN "paymentEvidenceOriginalName" TEXT,
  ADD COLUMN "paymentEvidenceMimeType" TEXT;
