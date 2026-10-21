-- Introduce a neutral branch for all existing records before making relations required.
CREATE TABLE "Branch" (
  "id" SERIAL NOT NULL, "name" TEXT NOT NULL, "address" TEXT, "details" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Branch_name_key" ON "Branch"("name");
INSERT INTO "Branch" ("name", "details") VALUES ('Sede Principal', 'Sede creada durante la migración de datos existentes');

ALTER TABLE "ReusableGroup" ADD COLUMN "branchId" INTEGER;
UPDATE "ReusableGroup" SET "branchId" = (SELECT "id" FROM "Branch" WHERE "name" = 'Sede Principal');
ALTER TABLE "ReusableGroup" ALTER COLUMN "branchId" SET NOT NULL;
DROP INDEX IF EXISTS "ReusableGroup_name_key";
CREATE UNIQUE INDEX "ReusableGroup_branchId_name_key" ON "ReusableGroup"("branchId", "name");
ALTER TABLE "ReusableGroup" ADD CONSTRAINT "ReusableGroup_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AcademicCycleBranch" (
  "academicCycleId" INTEGER NOT NULL, "branchId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AcademicCycleBranch_pkey" PRIMARY KEY ("academicCycleId", "branchId")
);
CREATE INDEX "AcademicCycleBranch_branchId_idx" ON "AcademicCycleBranch"("branchId");
ALTER TABLE "AcademicCycleBranch" ADD CONSTRAINT "AcademicCycleBranch_academicCycleId_fkey" FOREIGN KEY ("academicCycleId") REFERENCES "AcademicCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AcademicCycleBranch" ADD CONSTRAINT "AcademicCycleBranch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
INSERT INTO "AcademicCycleBranch" ("academicCycleId", "branchId") SELECT "id", (SELECT "id" FROM "Branch" WHERE "name"='Sede Principal') FROM "AcademicCycle";

ALTER TABLE "AcademicEnrollment" ADD COLUMN "branchId" INTEGER;
UPDATE "AcademicEnrollment" e SET "branchId" = rg."branchId" FROM "Group" cg JOIN "ReusableGroup" rg ON rg."id"=cg."reusableGroupId" WHERE e."groupId"=cg."id";
ALTER TABLE "AcademicEnrollment" ALTER COLUMN "branchId" SET NOT NULL;
CREATE INDEX "AcademicEnrollment_branchId_idx" ON "AcademicEnrollment"("branchId");
ALTER TABLE "AcademicEnrollment" ADD CONSTRAINT "AcademicEnrollment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "EnrollmentTransfer" (
  "id" SERIAL NOT NULL, "enrollmentId" INTEGER NOT NULL, "previousBranchId" INTEGER NOT NULL,
  "previousGroupId" INTEGER NOT NULL, "newBranchId" INTEGER NOT NULL, "newGroupId" INTEGER NOT NULL,
  "transferDate" DATE NOT NULL, "reason" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EnrollmentTransfer_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EnrollmentTransfer_enrollmentId_transferDate_idx" ON "EnrollmentTransfer"("enrollmentId", "transferDate");
ALTER TABLE "EnrollmentTransfer" ADD CONSTRAINT "EnrollmentTransfer_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "AcademicEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EnrollmentTransfer" ADD CONSTRAINT "EnrollmentTransfer_previousBranchId_fkey" FOREIGN KEY ("previousBranchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EnrollmentTransfer" ADD CONSTRAINT "EnrollmentTransfer_newBranchId_fkey" FOREIGN KEY ("newBranchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EnrollmentTransfer" ADD CONSTRAINT "EnrollmentTransfer_previousGroupId_fkey" FOREIGN KEY ("previousGroupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EnrollmentTransfer" ADD CONSTRAINT "EnrollmentTransfer_newGroupId_fkey" FOREIGN KEY ("newGroupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PensionObligation" (
  "id" SERIAL NOT NULL, "enrollmentId" INTEGER NOT NULL, "period" TEXT NOT NULL, "name" TEXT NOT NULL,
  "baseAmount" DECIMAL(12,2) NOT NULL, "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "amount" DECIMAL(12,2) NOT NULL, "dueDate" DATE NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PensionObligation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PensionObligation_amounts_check" CHECK ("baseAmount" >= 0 AND "discountAmount" >= 0 AND "amount" = "baseAmount" - "discountAmount")
);
CREATE UNIQUE INDEX "PensionObligation_enrollmentId_period_key" ON "PensionObligation"("enrollmentId", "period");
ALTER TABLE "PensionObligation" ADD CONSTRAINT "PensionObligation_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "AcademicEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
INSERT INTO "PensionObligation" ("enrollmentId", "period", "name", "baseAmount", "discountAmount", "amount", "dueDate")
SELECT e."id", to_char(m, 'YYYY-MM'), COALESCE(e."pensionName", 'Pensión'), e."pensionBaseAmount", COALESCE(e."pensionDiscountAmount",0), e."pensionAmount",
       (date_trunc('month', m) + (LEAST(e."pensionDueDay", EXTRACT(day FROM (date_trunc('month',m)+interval '1 month - 1 day')))::int - 1) * interval '1 day')::date
FROM "AcademicEnrollment" e
CROSS JOIN LATERAL generate_series(date_trunc('month', COALESCE(e."pensionStartDate", (SELECT "startDate" FROM "AcademicCycle" WHERE "id"=e."academicCycleId"))), date_trunc('month', COALESCE(e."pensionEndDate", (SELECT "endDate" FROM "AcademicCycle" WHERE "id"=e."academicCycleId"))), interval '1 month') m
WHERE e."pensionAmount" IS NOT NULL AND e."pensionDueDay" IS NOT NULL;

ALTER TABLE "Payment" ADD COLUMN "branchName" TEXT, ADD COLUMN "groupName" TEXT;
UPDATE "Payment" p SET "branchName"=b."name", "groupName"=rg."name" FROM "AcademicEnrollment" e JOIN "Branch" b ON b."id"=e."branchId" JOIN "Group" cg ON cg."id"=e."groupId" JOIN "ReusableGroup" rg ON rg."id"=cg."reusableGroupId" WHERE p."enrollmentId"=e."id";
