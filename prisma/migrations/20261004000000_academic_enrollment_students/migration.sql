-- Academic enrollment belongs to the student person record. Platform access is optional.
ALTER TABLE "AcademicEnrollment"
  DROP CONSTRAINT "AcademicEnrollment_studentId_fkey";

CREATE TEMPORARY TABLE "AcademicEnrollmentStudentMap" ON COMMIT DROP AS
SELECT enrollment."id" AS "enrollmentId", student."id" AS "studentId"
FROM "AcademicEnrollment" AS enrollment
JOIN "Student" AS student ON student."userId" = enrollment."studentId";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "AcademicEnrollment" AS enrollment
    LEFT JOIN "AcademicEnrollmentStudentMap" AS mapping
      ON mapping."enrollmentId" = enrollment."id"
    WHERE mapping."enrollmentId" IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot migrate academic enrollment without a matching student record';
  END IF;
END $$;

-- Use a temporary negative key to avoid transient collisions between legacy user
-- IDs and the new student IDs while preserving the per-cycle unique constraint.
UPDATE "AcademicEnrollment" AS enrollment
SET "studentId" = -mapping."studentId"
FROM "AcademicEnrollmentStudentMap" AS mapping
WHERE mapping."enrollmentId" = enrollment."id";

UPDATE "AcademicEnrollment"
SET "studentId" = -"studentId";

ALTER TABLE "AcademicEnrollment"
  ADD CONSTRAINT "AcademicEnrollment_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
