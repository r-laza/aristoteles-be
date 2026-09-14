-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE');

-- CreateTable
CREATE TABLE "AcademicCycle" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "baseEnrollmentAmount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademicCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Group" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "academicCycleId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademicEnrollment" (
    "id" SERIAL NOT NULL,
    "studentId" INTEGER NOT NULL,
    "academicCycleId" INTEGER NOT NULL,
    "groupId" INTEGER NOT NULL,
    "baseAmount" DECIMAL(12,2) NOT NULL,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discountReason" TEXT,
    "finalAmount" DECIMAL(12,2) NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademicEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Group_academicCycleId_name_key" ON "Group"("academicCycleId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Group_id_academicCycleId_key" ON "Group"("id", "academicCycleId");

-- CreateIndex
CREATE INDEX "AcademicEnrollment_academicCycleId_idx" ON "AcademicEnrollment"("academicCycleId");

-- CreateIndex
CREATE INDEX "AcademicEnrollment_groupId_academicCycleId_idx" ON "AcademicEnrollment"("groupId", "academicCycleId");

-- CreateIndex
CREATE UNIQUE INDEX "AcademicEnrollment_studentId_academicCycleId_key" ON "AcademicEnrollment"("studentId", "academicCycleId");

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_academicCycleId_fkey" FOREIGN KEY ("academicCycleId") REFERENCES "AcademicCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademicEnrollment" ADD CONSTRAINT "AcademicEnrollment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademicEnrollment" ADD CONSTRAINT "AcademicEnrollment_academicCycleId_fkey" FOREIGN KEY ("academicCycleId") REFERENCES "AcademicCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademicEnrollment" ADD CONSTRAINT "AcademicEnrollment_groupId_academicCycleId_fkey" FOREIGN KEY ("groupId", "academicCycleId") REFERENCES "Group"("id", "academicCycleId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve monetary invariants even for database writes outside the API.
ALTER TABLE "AcademicCycle" ADD CONSTRAINT "AcademicCycle_valid_dates_amount" CHECK ("endDate" >= "startDate" AND "baseEnrollmentAmount" >= 0);
ALTER TABLE "AcademicEnrollment" ADD CONSTRAINT "AcademicEnrollment_valid_amounts" CHECK ("baseAmount" >= 0 AND "discountAmount" >= 0 AND "discountAmount" <= "baseAmount" AND "finalAmount" = "baseAmount" - "discountAmount");
