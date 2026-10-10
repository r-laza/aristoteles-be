CREATE TYPE "ReceiptDocumentType" AS ENUM ('DNI', 'CE', 'PASSPORT');
CREATE TYPE "ReceiptRelationship" AS ENUM ('FATHER', 'MOTHER', 'GUARDIAN', 'OTHER');

ALTER TABLE "Payment"
ADD COLUMN "payerName" TEXT,
ADD COLUMN "payerDocumentType" "ReceiptDocumentType",
ADD COLUMN "payerDocumentNumber" TEXT,
ADD COLUMN "payerRelationship" "ReceiptRelationship",
ADD COLUMN "receiptNumber" TEXT,
ADD COLUMN "receiptGeneratedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Payment_receiptNumber_key" ON "Payment"("receiptNumber");

CREATE TABLE "ReceiptCounter" (
  "year" INTEGER NOT NULL,
  "lastValue" INTEGER NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReceiptCounter_pkey" PRIMARY KEY ("year")
);
