import { Prisma } from '@prisma/client';
import { notificationConfig } from './notification.config';
import { PaymentReminderService } from './payment-reminder.service';
import { WhatsAppNotificationService } from './whatsapp-notification.service';

describe('WhatsApp notifications', () => {
  const originalEnv = process.env;
  afterEach(() => { process.env = originalEnv; jest.restoreAllMocks(); });

  it('uses a safe default and accepts a configured reminder window', () => {
    expect(notificationConfig({ WHATSAPP_REMINDER_DAYS: 'invalid' } as NodeJS.ProcessEnv).reminderDays).toBe(2);
    expect(notificationConfig({ WHATSAPP_REMINDER_DAYS: '5' } as NodeJS.ProcessEnv).reminderDays).toBe(5);
    expect(notificationConfig({ WHATSAPP_REMINDER_DAYS: '0' } as NodeJS.ProcessEnv).reminderDays).toBe(2);
  });

  it.each([
    ['0995762122', '+51995762122'],
    ['995762122', '+51995762122'],
    ['+51995762122', '+51995762122'],
    ['not-a-phone', null],
  ])('normalizes %s to %s', (input, expected) => {
    expect(new WhatsAppNotificationService().normalizePhone(input)).toBe(expected);
  });

  it('does not process automatically outside production', async () => {
    process.env = { ...originalEnv, APP_ENV: 'local', WHATSAPP_ENABLED: 'true' };
    const prisma = { pensionObligation: { findMany: jest.fn() } };
    const service = new PaymentReminderService(prisma as never, {} as never);
    await expect(service.processAutomatic('2026-10-20')).resolves.toEqual({ processed: 0, sent: 0, failed: 0, skipped: true });
    expect(prisma.pensionObligation.findMany).not.toHaveBeenCalled();
  });

  it('uses WHATSAPP_REMINDER_DAYS and ignores fully paid obligations', async () => {
    process.env = { ...originalEnv, APP_ENV: 'prd', WHATSAPP_ENABLED: 'true', WHATSAPP_REMINDER_DAYS: '5' };
    const candidate = {
      id: 1, period: '2026-10', amount: new Prisma.Decimal(200), dueDate: new Date('2026-10-25T00:00:00Z'),
      enrollment: { studentId: 1, student: { primaryPhone: '995762122', representativeName: 'Rep', fullName: 'Student' }, academicCycle: {}, payments: [{ paymentType: 'PENSION', period: '2026-10', amount: new Prisma.Decimal(200) }] },
    };
    const prisma = { pensionObligation: { findMany: jest.fn().mockResolvedValue([candidate]) }, notificationLog: { create: jest.fn() } };
    const service = new PaymentReminderService(prisma as never, {} as never);
    await expect(service.processAutomatic('2026-10-20')).resolves.toMatchObject({ sent: 0, failed: 0 });
    expect(prisma.pensionObligation.findMany.mock.calls[0][0].where.dueDate).toEqual(new Date('2026-10-25T00:00:00Z'));
    expect(prisma.notificationLog.create).not.toHaveBeenCalled();
  });
});
