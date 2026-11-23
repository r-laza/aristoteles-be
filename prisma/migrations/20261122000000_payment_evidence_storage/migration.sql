-- Existing rows remain NULL and continue to use the currently configured
-- provider, preserving legacy payment-evidence/* keys.
ALTER TABLE "Payment" ADD COLUMN "paymentEvidenceStorage" TEXT;
