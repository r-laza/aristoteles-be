CREATE TYPE "NotificationType" AS ENUM ('PENSION_REMINDER');
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'DELIVERED');

CREATE TABLE "NotificationLog" (
  "id" SERIAL NOT NULL,
  "studentId" INTEGER NOT NULL,
  "obligationId" INTEGER NOT NULL,
  "type" "NotificationType" NOT NULL,
  "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
  "providerMessageId" TEXT,
  "sentAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationLog_obligationId_type_key" ON "NotificationLog"("obligationId", "type");
CREATE INDEX "NotificationLog_studentId_createdAt_idx" ON "NotificationLog"("studentId", "createdAt");
CREATE INDEX "NotificationLog_status_createdAt_idx" ON "NotificationLog"("status", "createdAt");
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "PensionObligation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
