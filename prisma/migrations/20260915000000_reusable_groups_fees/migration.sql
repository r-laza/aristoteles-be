BEGIN;

CREATE TABLE "ReusableGroup" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL
);
CREATE UNIQUE INDEX "ReusableGroup_name_key" ON "ReusableGroup"("name");
INSERT INTO "ReusableGroup" ("name") SELECT DISTINCT "name" FROM "Group";
ALTER TABLE "Group" ADD COLUMN "reusableGroupId" INTEGER;
UPDATE "Group" g SET "reusableGroupId" = r."id" FROM "ReusableGroup" r WHERE r."name" = g."name";
ALTER TABLE "Group" ALTER COLUMN "reusableGroupId" SET NOT NULL;
ALTER TABLE "Group" ADD CONSTRAINT "Group_reusableGroupId_fkey" FOREIGN KEY ("reusableGroupId") REFERENCES "ReusableGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
DROP INDEX "Group_academicCycleId_name_key";
ALTER TABLE "Group" DROP COLUMN "name";
CREATE UNIQUE INDEX "Group_academicCycleId_reusableGroupId_key" ON "Group"("academicCycleId", "reusableGroupId");

CREATE TABLE "EnrollmentFee" (
  "id" SERIAL PRIMARY KEY,
  "cycleGroupId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "validFrom" DATE NOT NULL,
  "validUntil" DATE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EnrollmentFee_cycleGroupId_fkey" FOREIGN KEY ("cycleGroupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "EnrollmentFee_valid_amount_dates" CHECK ("amount" >= 0 AND ("validUntil" IS NULL OR "validUntil" >= "validFrom"))
);
CREATE UNIQUE INDEX "EnrollmentFee_id_cycleGroupId_key" ON "EnrollmentFee"("id", "cycleGroupId");
CREATE INDEX "EnrollmentFee_cycleGroupId_idx" ON "EnrollmentFee"("cycleGroupId");
-- Preserve each former cycle price as a group option, and each distinct historical assigned price.
INSERT INTO "EnrollmentFee" ("cycleGroupId", "name", "amount", "validFrom")
SELECT g."id", c."name", c."baseEnrollmentAmount", c."startDate" FROM "Group" g JOIN "AcademicCycle" c ON c."id" = g."academicCycleId";
INSERT INTO "EnrollmentFee" ("cycleGroupId", "name", "amount", "validFrom", "validUntil")
SELECT e."groupId", c."name", e."baseAmount", LEAST(c."startDate", MIN(e."createdAt"::date)), GREATEST(c."startDate", MAX(e."createdAt"::date))
FROM "AcademicEnrollment" e JOIN "AcademicCycle" c ON c."id" = e."academicCycleId"
WHERE e."baseAmount" <> c."baseEnrollmentAmount"
GROUP BY e."groupId", c."name", c."startDate", e."baseAmount";
ALTER TABLE "AcademicEnrollment" ADD COLUMN "feeId" INTEGER;
UPDATE "AcademicEnrollment" e SET "feeId" = f."id" FROM "EnrollmentFee" f WHERE f."cycleGroupId" = e."groupId" AND f."amount" = e."baseAmount";
ALTER TABLE "AcademicEnrollment" ALTER COLUMN "feeId" SET NOT NULL;
ALTER TABLE "AcademicEnrollment" ADD CONSTRAINT "AcademicEnrollment_feeId_groupId_fkey" FOREIGN KEY ("feeId", "groupId") REFERENCES "EnrollmentFee"("id", "cycleGroupId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AcademicCycle" DROP CONSTRAINT "AcademicCycle_valid_dates_amount";
ALTER TABLE "AcademicCycle" DROP COLUMN "baseEnrollmentAmount";
ALTER TABLE "AcademicCycle" ADD CONSTRAINT "AcademicCycle_valid_dates" CHECK ("endDate" >= "startDate");

COMMIT;
