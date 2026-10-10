-- Preserve configured and agreed pension prices independently for each enrollment.
ALTER TABLE "AcademicEnrollment"
  ADD COLUMN "pensionBaseAmount" DECIMAL(12,2),
  ADD COLUMN "pensionDiscountPercent" DECIMAL(5,2),
  ADD COLUMN "pensionDiscountAmount" DECIMAL(12,2);

-- Existing pensionAmount values are already historical agreed monthly prices.
-- Their percentage is left unknown rather than inferred from rounded money.
UPDATE "AcademicEnrollment"
SET "pensionBaseAmount" = "pensionAmount",
    "pensionDiscountAmount" = CASE
      WHEN "pensionAmount" IS NULL THEN NULL
      ELSE 0
    END;

ALTER TABLE "AcademicEnrollment"
  ADD CONSTRAINT "AcademicEnrollment_valid_pension_discount"
  CHECK (
    ("pensionBaseAmount" IS NULL
      AND "pensionDiscountPercent" IS NULL
      AND "pensionDiscountAmount" IS NULL
      AND "pensionAmount" IS NULL)
    OR
    ("pensionBaseAmount" >= 0
      AND "pensionDiscountAmount" >= 0
      AND "pensionDiscountAmount" <= "pensionBaseAmount"
      AND "pensionAmount" = "pensionBaseAmount" - "pensionDiscountAmount"
      AND ("pensionDiscountPercent" IS NULL
        OR ("pensionDiscountPercent" >= 0 AND "pensionDiscountPercent" <= 100)))
  );
