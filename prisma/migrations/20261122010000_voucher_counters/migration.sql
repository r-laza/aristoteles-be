CREATE TABLE "VoucherCounter" (
    "academicCycleId" INTEGER NOT NULL,
    "studentId" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoucherCounter_pkey" PRIMARY KEY ("academicCycleId", "studentId")
);

ALTER TABLE "VoucherCounter"
ADD CONSTRAINT "VoucherCounter_academicCycleId_fkey"
FOREIGN KEY ("academicCycleId") REFERENCES "AcademicCycle"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VoucherCounter"
ADD CONSTRAINT "VoucherCounter_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "Student"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
