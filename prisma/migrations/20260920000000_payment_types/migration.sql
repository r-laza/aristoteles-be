CREATE TYPE "PaymentType" AS ENUM ('ENROLLMENT', 'PENSION');
ALTER TABLE "Payment" ADD COLUMN "paymentType" "PaymentType" NOT NULL DEFAULT 'ENROLLMENT',
ADD COLUMN "period" TEXT;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_period_type_check" CHECK (
("paymentType" = 'ENROLLMENT' AND "period" IS NULL) OR
("paymentType" = 'PENSION' AND "period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'));
ALTER TABLE "AcademicEnrollment" ADD COLUMN "pensionAmount" DECIMAL(12,2),
ADD COLUMN "pensionDueDay" INTEGER;
UPDATE "AcademicEnrollment" e SET "pensionAmount" = p.amount, "pensionDueDay" = p."dueDay"
FROM "Group" g JOIN "Pension" p ON p.id = g."pensionId" WHERE e."groupId" = g.id;

ALTER TABLE "AcademicEnrollment" ADD COLUMN "pensionStartDate" DATE, ADD COLUMN "pensionEndDate" DATE;
UPDATE "AcademicEnrollment" e SET "pensionStartDate" = c."startDate", "pensionEndDate" = c."endDate"
FROM "AcademicCycle" c WHERE e."academicCycleId" = c.id;
