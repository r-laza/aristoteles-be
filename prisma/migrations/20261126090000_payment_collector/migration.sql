ALTER TABLE "Payment"
ADD COLUMN "collectorId" INTEGER,
ADD COLUMN "registeredBranchId" INTEGER;

CREATE INDEX "Payment_collectorId_paymentDate_idx"
ON "Payment"("collectorId", "paymentDate");

CREATE INDEX "Payment_registeredBranchId_paymentDate_idx"
ON "Payment"("registeredBranchId", "paymentDate");

ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_collectorId_fkey"
FOREIGN KEY ("collectorId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
