-- Move branch ownership from the reusable group catalog to each cycle assignment.
ALTER TABLE "Group" ADD COLUMN "branchId" INTEGER;

UPDATE "Group" cg
SET "branchId" = rg."branchId"
FROM "ReusableGroup" rg
WHERE rg."id" = cg."reusableGroupId";

ALTER TABLE "Group" ALTER COLUMN "branchId" SET NOT NULL;

-- Enrollment already stores its branch. Existing rows must agree with their assignment.
UPDATE "AcademicEnrollment" e
SET "branchId" = cg."branchId"
FROM "Group" cg
WHERE cg."id" = e."groupId";

ALTER TABLE "AcademicEnrollment" DROP CONSTRAINT "AcademicEnrollment_groupId_academicCycleId_fkey";
DROP INDEX "Group_academicCycleId_reusableGroupId_key";
DROP INDEX "Group_id_academicCycleId_key";

-- Merge same-named branch-local catalog rows into one reusable catalog row.
CREATE TEMP TABLE "ReusableGroupMerge" AS
SELECT "id" AS "oldId", MIN("id") OVER (PARTITION BY "name") AS "keepId"
FROM "ReusableGroup";

UPDATE "Group" cg
SET "reusableGroupId" = m."keepId"
FROM "ReusableGroupMerge" m
WHERE cg."reusableGroupId" = m."oldId" AND m."oldId" <> m."keepId";

DELETE FROM "ReusableGroup" rg
USING "ReusableGroupMerge" m
WHERE rg."id" = m."oldId" AND m."oldId" <> m."keepId";

DROP INDEX "ReusableGroup_branchId_name_key";
ALTER TABLE "ReusableGroup" DROP CONSTRAINT "ReusableGroup_branchId_fkey";
ALTER TABLE "ReusableGroup" DROP COLUMN "branchId";
CREATE UNIQUE INDEX "ReusableGroup_name_key" ON "ReusableGroup"("name");

CREATE INDEX "Group_branchId_idx" ON "Group"("branchId");
CREATE UNIQUE INDEX "Group_academicCycleId_branchId_reusableGroupId_key"
ON "Group"("academicCycleId", "branchId", "reusableGroupId");
CREATE UNIQUE INDEX "Group_id_academicCycleId_branchId_key"
ON "Group"("id", "academicCycleId", "branchId");
ALTER TABLE "Group" ADD CONSTRAINT "Group_branchId_fkey"
FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AcademicEnrollment" ADD CONSTRAINT "AcademicEnrollment_groupId_academicCycleId_branchId_fkey"
FOREIGN KEY ("groupId", "academicCycleId", "branchId") REFERENCES "Group"("id", "academicCycleId", "branchId") ON DELETE RESTRICT ON UPDATE CASCADE;
