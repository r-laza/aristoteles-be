CREATE TYPE "AcademicCycleStatus" AS ENUM ('UPCOMING', 'ACTIVE', 'CLOSED');

ALTER TABLE "AcademicCycle"
ADD COLUMN "status" "AcademicCycleStatus" NOT NULL DEFAULT 'UPCOMING';

UPDATE "AcademicCycle"
SET "status" = CASE
  WHEN "endDate" < CURRENT_DATE THEN 'CLOSED'::"AcademicCycleStatus"
  WHEN "startDate" <= CURRENT_DATE AND "endDate" >= CURRENT_DATE THEN 'ACTIVE'::"AcademicCycleStatus"
  ELSE 'UPCOMING'::"AcademicCycleStatus"
END;
