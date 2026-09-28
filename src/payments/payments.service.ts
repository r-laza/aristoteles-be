import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentMethod, Prisma } from '@prisma/client';
import { obligations, paymentStatus } from './obligations';
import { PrismaService } from '../database/prisma.service';

function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > max)
    throw new BadRequestException();
  return value.trim() || null;
}
@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}
  async balances(cycleId: number) {
    if (
      !(await this.prisma.academicCycle.findUnique({
        where: { id: cycleId },
        select: { id: true },
      }))
    )
      throw new NotFoundException();
    const enrollments = await this.prisma.enrollment.findMany({
      where: { academicCycleId: cycleId },
      select: {
        id: true,
        enrollmentFeeName: true,
        pensionName: true,
        fee: { select: { name: true } },
        baseAmount: true,
        discountAmount: true,
        finalAmount: true,
        pensionStartDate: true,
        pensionEndDate: true,
        pensionAmount: true,
        pensionDueDay: true,
        academicCycle: {
          select: { name: true, startDate: true, endDate: true },
        },
        student: { select: { id: true, fullName: true, username: true } },
        group: {
          select: { id: true, reusableGroup: { select: { name: true } } },
        },
        payments: {
          select: {
            amount: true,
            paymentType: true,
            period: true,
            paymentDate: true,
          },
          orderBy: { paymentDate: 'desc' },
        },
      },
      orderBy: { student: { fullName: 'asc' } },
    });
    const rows = enrollments.map((enrollment) => {
      const charges = obligations(enrollment);
      const amountDue = charges.reduce(
        (sum, c) => sum.plus(c.amountDue),
        new Prisma.Decimal(0),
      );
      const amountPaid = charges.reduce(
        (sum, c) => sum.plus(c.amountPaid),
        new Prisma.Decimal(0),
      );
      const balance = amountDue.minus(amountPaid);
      return {
        id: enrollment.id,
        student: enrollment.student,
        group: {
          id: enrollment.group.id,
          name: enrollment.group.reusableGroup.name,
        },
        cycle: enrollment.academicCycle.name,
        enrollmentFeeName: enrollment.enrollmentFeeName ?? enrollment.fee.name,
        pensionName: enrollment.pensionName,
        pensionMonthlyAmount: enrollment.pensionAmount,
        baseAmount: enrollment.baseAmount,
        discountAmount: enrollment.discountAmount,
        obligations: charges,
        amountDue,
        amountPaid,
        balance,
        lastPaymentDate: enrollment.payments[0]?.paymentDate ?? null,
        status: paymentStatus(
          balance,
          amountPaid,
          charges.some((c) => c.status === 'OVERDUE'),
        ),
      };
    });
    const totals = rows.reduce(
      (sum, row) => ({
        amountDue: sum.amountDue.plus(row.amountDue),
        amountPaid: sum.amountPaid.plus(row.amountPaid),
        balance: sum.balance.plus(row.balance),
      }),
      {
        amountDue: new Prisma.Decimal(0),
        amountPaid: new Prisma.Decimal(0),
        balance: new Prisma.Decimal(0),
      },
    );
    return { rows, totals };
  }
  async history(enrollmentId: number) {
    if (
      !(await this.prisma.enrollment.findUnique({
        where: { id: enrollmentId },
        select: { id: true },
      }))
    )
      throw new NotFoundException();
    return this.prisma.payment.findMany({
      where: { enrollmentId },
      orderBy: [{ paymentDate: 'desc' }, { id: 'desc' }],
    });
  }
  async register(enrollmentId: number, body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new BadRequestException();
    const input = body as Record<string, unknown>;
    if (
      (typeof input.amount !== 'string' && typeof input.amount !== 'number') ||
      !/^\d{1,10}(\.\d{1,2})?$/.test(String(input.amount))
    )
      throw new BadRequestException('Invalid amount');
    const amount = new Prisma.Decimal(input.amount);
    if (!amount.greaterThan(0))
      throw new BadRequestException('Payment must be positive');
    if (
      typeof input.paymentDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.paymentDate)
    )
      throw new BadRequestException('Invalid date');
    const paymentDate = new Date(`${input.paymentDate}T00:00:00.000Z`);
    if (
      !Number.isFinite(paymentDate.getTime()) ||
      paymentDate.toISOString().slice(0, 10) !== input.paymentDate
    )
      throw new BadRequestException('Invalid date');
    if (
      !Object.values(PaymentMethod).includes(
        input.paymentMethod as PaymentMethod,
      )
    )
      throw new BadRequestException('Invalid method');
    const paymentType = input.paymentType ?? 'ENROLLMENT';
    if (paymentType !== 'ENROLLMENT' && paymentType !== 'PENSION')
      throw new BadRequestException('Invalid payment type');
    const period = input.period ?? null;
    if (
      (paymentType === 'ENROLLMENT' && period !== null) ||
      (paymentType === 'PENSION' &&
        (typeof period !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)))
    )
      throw new BadRequestException('Invalid payment period');
    const reference = optionalText(input.reference, 200),
      notes = optionalText(input.notes, 1000);
    return this.prisma.$transaction(
      async (tx) => {
        // Serialize payments for this enrollment so concurrent requests cannot overpay.
        const locked = await tx.$queryRaw<
          { id: number }[]
        >`SELECT "id" FROM "AcademicEnrollment" WHERE "id" = ${enrollmentId} FOR UPDATE`;
        if (!locked.length) throw new NotFoundException();
        const enrollment = await tx.enrollment.findUniqueOrThrow({
          where: { id: enrollmentId },
          include: { academicCycle: true, payments: true },
        });
        const charge = obligations(enrollment).find(
          (c) => c.paymentType === paymentType && c.period === period,
        );
        if (!charge)
          throw new BadRequestException('Payment obligation unavailable');
        const balance = charge.balance;
        if (amount.greaterThan(balance))
          throw new ConflictException('Payment exceeds remaining balance');
        return tx.payment.create({
          data: {
            enrollmentId,
            paymentType,
            period: period as string | null,
            amount,
            paymentDate,
            paymentMethod: input.paymentMethod as PaymentMethod,
            reference,
            notes,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }
}
