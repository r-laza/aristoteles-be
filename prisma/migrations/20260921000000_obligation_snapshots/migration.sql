ALTER TABLE "AcademicEnrollment" ADD COLUMN "enrollmentFeeName" TEXT, ADD COLUMN "pensionName" TEXT;
UPDATE "AcademicEnrollment" e SET "enrollmentFeeName" = f.name FROM "EnrollmentFee" f WHERE f.id = e."feeId";
UPDATE "AcademicEnrollment" e SET "pensionName" = p.name
FROM "Group" g JOIN "Pension" p ON p.id = g."pensionId" WHERE e."groupId" = g.id;
-- Repair missing assignments only; never reprice existing pension snapshots.
UPDATE "AcademicEnrollment" e SET "pensionAmount" = p.amount, "pensionDueDay" = p."dueDay",
"pensionStartDate" = c."startDate", "pensionEndDate" = c."endDate"
FROM "Group" g JOIN "Pension" p ON p.id = g."pensionId"
JOIN "AcademicCycle" c ON c.id = g."academicCycleId"
WHERE e."groupId" = g.id AND e."pensionAmount" IS NULL;
