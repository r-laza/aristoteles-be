BEGIN;
CREATE TABLE "_CycleGroupToEnrollmentFee" (
  "A" INTEGER NOT NULL REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "B" INTEGER NOT NULL REFERENCES "EnrollmentFee"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "_CycleGroupToEnrollmentFee_AB_unique" ON "_CycleGroupToEnrollmentFee"("A", "B");
CREATE INDEX "_CycleGroupToEnrollmentFee_B_index" ON "_CycleGroupToEnrollmentFee"("B");
INSERT INTO "_CycleGroupToEnrollmentFee" ("A", "B") SELECT "cycleGroupId", "id" FROM "EnrollmentFee";
ALTER TABLE "AcademicEnrollment" DROP CONSTRAINT "AcademicEnrollment_feeId_groupId_fkey";
ALTER TABLE "AcademicEnrollment" ADD CONSTRAINT "AcademicEnrollment_feeId_fkey" FOREIGN KEY ("feeId") REFERENCES "EnrollmentFee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EnrollmentFee" DROP COLUMN "cycleGroupId";
COMMIT;
