-- Keep discountAmount and finalAmount as immutable monetary snapshots.
-- Historical percentages remain unknown instead of being inferred from rounded money.
ALTER TABLE "AcademicEnrollment"
  ADD COLUMN "discountPercent" DECIMAL(5,2);

ALTER TABLE "AcademicEnrollment"
  ADD CONSTRAINT "AcademicEnrollment_valid_discount_percent"
  CHECK (
    "discountPercent" IS NULL
    OR ("discountPercent" >= 0 AND "discountPercent" <= 100)
  );
