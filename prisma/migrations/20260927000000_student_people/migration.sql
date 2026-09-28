-- Keep the existing dashboard students while expanding them into person records.
ALTER TABLE "Student" RENAME COLUMN "name" TO "fullName";
DROP INDEX "Student_name_key";

CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');
CREATE TYPE "Relationship" AS ENUM ('FATHER', 'MOTHER', 'OTHER');

ALTER TABLE "Student"
  ADD COLUMN "dni" TEXT,
  ADD COLUMN "firstName" TEXT,
  ADD COLUMN "lastName" TEXT,
  ADD COLUMN "birthDate" DATE,
  ADD COLUMN "gender" "Gender",
  ADD COLUMN "representativeName" TEXT,
  ADD COLUMN "relationship" "Relationship",
  ADD COLUMN "relationshipOther" TEXT,
  ADD COLUMN "primaryPhone" TEXT,
  ADD COLUMN "secondaryPhone" TEXT,
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "userId" INTEGER;

-- Backfill old demo rows and student users so existing installations remain usable.
UPDATE "Student" SET
  "dni" = 'LEGACY-' || "id",
  "firstName" = "fullName",
  "lastName" = '',
  "birthDate" = DATE '1970-01-01',
  "gender" = 'OTHER',
  "representativeName" = 'Sin registrar',
  "relationship" = 'OTHER',
  "relationshipOther" = 'Sin registrar',
  "primaryPhone" = 'Sin registrar';

INSERT INTO "Student" (
  "fullName", "initials", "dni", "firstName", "lastName", "birthDate",
  "gender", "representativeName", "relationship", "relationshipOther",
  "primaryPhone", "isActive", "createdAt", "updatedAt", "userId"
)
SELECT
  u."fullName",
  LEFT(COALESCE(NULLIF(SPLIT_PART(u."fullName", ' ', 1), ''), 'E'), 1) ||
    LEFT(COALESCE(NULLIF(SPLIT_PART(u."fullName", ' ', 2), ''), 'S'), 1),
  'USER-' || u."id", u."fullName", '', DATE '1970-01-01', 'OTHER',
  'Sin registrar', 'OTHER', 'Sin registrar', 'Sin registrar', u."isActive",
  u."createdAt", u."updatedAt", u."id"
FROM "User" u
WHERE u."role" = 'STUDENT'
  AND NOT EXISTS (SELECT 1 FROM "Student" s WHERE s."fullName" = u."fullName");

UPDATE "Student" s SET "userId" = u."id", "isActive" = u."isActive"
FROM "User" u
WHERE u."role" = 'STUDENT' AND s."fullName" = u."fullName" AND s."userId" IS NULL;

ALTER TABLE "Student"
  ALTER COLUMN "dni" SET NOT NULL,
  ALTER COLUMN "firstName" SET NOT NULL,
  ALTER COLUMN "lastName" SET NOT NULL,
  ALTER COLUMN "birthDate" SET NOT NULL,
  ALTER COLUMN "gender" SET NOT NULL,
  ALTER COLUMN "representativeName" SET NOT NULL,
  ALTER COLUMN "relationship" SET NOT NULL,
  ALTER COLUMN "primaryPhone" SET NOT NULL;

CREATE UNIQUE INDEX "Student_dni_key" ON "Student"("dni");
CREATE UNIQUE INDEX "Student_userId_key" ON "Student"("userId");
ALTER TABLE "Student" ADD CONSTRAINT "Student_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
