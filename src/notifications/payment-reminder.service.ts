import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NotificationStatus, NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { institutionToday } from '../payments/obligations';
import { notificationConfig } from './notification.config';
import { WhatsAppNotificationService } from './whatsapp-notification.service';

type Candidate = Prisma.PensionObligationGetPayload<{
  include: { enrollment: { include: { student: true; academicCycle: true; payments: true } } };
}>;

@Injectable()
export class PaymentReminderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppNotificationService,
  ) {}

  async processAutomatic(today = institutionToday()) {
    const config = notificationConfig();
    if (!config.enabled || config.appEnv !== 'prd')
      return { processed: 0, sent: 0, failed: 0, skipped: true };
    const target = new Date(`${today}T00:00:00.000Z`);
    target.setUTCDate(target.getUTCDate() + config.reminderDays);
    const candidates = await this.prisma.pensionObligation.findMany({
      where: {
        dueDate: target,
        enrollment: {
          status: 'ACTIVE',
          academicCycle: {
            startDate: { lte: new Date(`${today}T00:00:00.000Z`) },
            endDate: { gte: new Date(`${today}T00:00:00.000Z`) },
          },
        },
        notificationLogs: { none: { type: NotificationType.PENSION_REMINDER } },
      },
      include: { enrollment: { include: { student: true, academicCycle: true, payments: true } } },
    });
    let sent = 0, failed = 0;
    for (const candidate of candidates) {
      if (!this.pendingAmount(candidate).greaterThan(0)) continue;
      const result = await this.send(candidate);
      if (result.status === NotificationStatus.SENT) sent += 1;
      else if (result.status === NotificationStatus.FAILED) failed += 1;
    }
    return { processed: candidates.length, sent, failed, skipped: false };
  }

  async sendManual(studentId: number) {
    const config = notificationConfig();
    if (config.appEnv !== 'local') throw new ForbiddenException('Manual notifications are local-only');
    if (!config.enabled) throw new BadRequestException('WhatsApp is disabled');
    const student = await this.prisma.student.findUnique({ where: { id: studentId }, select: { id: true } });
    if (!student) throw new NotFoundException();
    const today = new Date(`${institutionToday()}T00:00:00.000Z`);
    const candidates = await this.prisma.pensionObligation.findMany({
      where: {
        enrollment: {
          studentId,
          status: 'ACTIVE',
          academicCycle: { startDate: { lte: today }, endDate: { gte: today } },
        },
        notificationLogs: { none: { type: NotificationType.PENSION_REMINDER } },
      },
      include: { enrollment: { include: { student: true, academicCycle: true, payments: true } } },
      orderBy: { dueDate: 'asc' },
    });
    const candidate = candidates.find((item) => this.pendingAmount(item).greaterThan(0));
    if (!candidate) throw new ConflictException('No pending pension reminder available');
    const result = await this.send(candidate);
    if (result.status === NotificationStatus.FAILED) throw new BadRequestException(result.errorMessage ?? 'Notification failed');
    return { status: result.status, providerMessageId: result.providerMessageId };
  }

  private pendingAmount(candidate: Candidate) {
    const paid = candidate.enrollment.payments
      .filter((payment) => payment.paymentType === 'PENSION' && payment.period === candidate.period)
      .reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0));
    return Prisma.Decimal.max(candidate.amount.minus(paid), 0);
  }

  private async send(candidate: Candidate) {
    let log: { id: number };
    try {
      log = await this.prisma.notificationLog.create({ data: {
        studentId: candidate.enrollment.studentId,
        obligationId: candidate.id,
        type: NotificationType.PENSION_REMINDER,
      }, select: { id: true } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        return { status: NotificationStatus.PENDING, providerMessageId: null, errorMessage: null };
      throw error;
    }
    const phone = this.whatsapp.normalizePhone(candidate.enrollment.student.primaryPhone);
    if (!phone) return this.fail(log.id, 'Invalid or missing representative phone');
    try {
      const providerMessageId = await this.whatsapp.sendTemplate(phone, {
        representativeName: candidate.enrollment.student.representativeName,
        studentName: candidate.enrollment.student.fullName,
        period: candidate.period,
        dueDate: candidate.dueDate,
        pendingAmount: this.pendingAmount(candidate).toFixed(2),
      });
      return await this.prisma.notificationLog.update({ where: { id: log.id }, data: {
        status: NotificationStatus.SENT, providerMessageId, sentAt: new Date(), errorMessage: null,
      } });
    } catch (error) {
      return this.fail(log.id, error instanceof Error ? error.message : 'Unknown provider error');
    }
  }

  private fail(id: number, message: string) {
    return this.prisma.notificationLog.update({ where: { id }, data: {
      status: NotificationStatus.FAILED, errorMessage: message.slice(0, 1000),
    } });
  }
}
