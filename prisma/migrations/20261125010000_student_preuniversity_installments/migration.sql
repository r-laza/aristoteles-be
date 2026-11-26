-- Preuniversitario payment plans are selected per student during enrollment.
-- Keep the legacy cycle-level columns nullable so existing data remains readable.
ALTER TABLE "AcademicCycle"
  DROP CONSTRAINT IF EXISTS "AcademicCycle_preuniversity_configuration_check";

ALTER TABLE "AcademicCycle"
  ADD CONSTRAINT "AcademicCycle_preuniversity_configuration_check" CHECK (
    ("category" = 'SCHOOL' AND "preuniversityFee" IS NULL AND "preuniversityInstallments" IS NULL AND "preuniversityDueRule" IS NULL)
    OR
    ("category" = 'PREUNIVERSITY' AND "feeId" IS NULL)
  );
