CREATE TYPE "AcademicCycleCategory" AS ENUM ('SCHOOL', 'PREUNIVERSITY');
CREATE TYPE "PreuniversityDueRule" AS ENUM ('FIFTEENTH', 'LAST_DAY');

ALTER TABLE "AcademicCycle"
  ADD COLUMN "category" "AcademicCycleCategory" NOT NULL DEFAULT 'SCHOOL',
  ADD COLUMN "preuniversityFee" DECIMAL(12,2),
  ADD COLUMN "preuniversityInstallments" INTEGER,
  ADD COLUMN "preuniversityDueRule" "PreuniversityDueRule";

ALTER TABLE "AcademicEnrollment" ALTER COLUMN "feeId" DROP NOT NULL;

ALTER TABLE "AcademicCycle"
  ADD CONSTRAINT "AcademicCycle_preuniversity_configuration_check" CHECK (
    ("category" = 'SCHOOL' AND "preuniversityFee" IS NULL AND "preuniversityInstallments" IS NULL AND "preuniversityDueRule" IS NULL)
    OR
    ("category" = 'PREUNIVERSITY' AND "feeId" IS NULL AND "preuniversityFee" > 0 AND "preuniversityInstallments" BETWEEN 1 AND 3 AND "preuniversityDueRule" IS NOT NULL)
  );
