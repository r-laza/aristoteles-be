CREATE TABLE "Pension" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL CHECK ("amount" >= 0),
  "dueDay" INTEGER NOT NULL CHECK ("dueDay" BETWEEN 1 AND 31),
  "isActive" BOOLEAN NOT NULL DEFAULT true
);
ALTER TABLE "AcademicCycle" ADD COLUMN "feeId" INTEGER REFERENCES "EnrollmentFee"("id") ON DELETE RESTRICT;
ALTER TABLE "Group" ADD COLUMN "pensionId" INTEGER REFERENCES "Pension"("id") ON DELETE RESTRICT;
-- Infer a general enrollment fee only when legacy assignments agree.
-- Leave ambiguous cycles and new monthly assignments for explicit configuration.
UPDATE "AcademicCycle" c SET "feeId" = fees.id
FROM (
 SELECT g."academicCycleId", MIN(f."B") AS id
 FROM "Group" g JOIN "_CycleGroupToEnrollmentFee" f ON f."A" = g.id
 GROUP BY g."academicCycleId" HAVING COUNT(DISTINCT f."B") = 1
) fees WHERE c.id = fees."academicCycleId";
