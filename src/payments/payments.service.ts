import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentMethod, Prisma } from '@prisma/client';
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
        baseAmount: true,
        discountAmount: true,
        finalAmount: true,
        student: { select: { id: true, fullName: true, username: true } },
        group: { select: { id: true, name: true } },
        payments: { select: { amount: true } },
      },
      orderBy: { student: { fullName: 'asc' } },
    });
    const rows = enrollments.map(
      ({ payments, finalAmount: amountDue, ...enrollment }) => {
        const amountPaid = payments.reduce(
          (sum, payment) => sum.plus(payment.amount),
          new Prisma.Decimal(0),
        );
        const balance = amountDue.minus(amountPaid);
        return {
          ...enrollment,
          amountDue,
          amountPaid,
          balance,
          status: balance.isZero()
            ? 'PAID'
            : amountPaid.isZero()
              ? 'PENDING'
              : 'PARTIAL',
        };
      },
    );
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
        });
        const paid = await tx.payment.aggregate({
          where: { enrollmentId },
          _sum: { amount: true },
        });
        const balance = enrollment.finalAmount.minus(paid._sum.amount ?? 0);
        if (amount.greaterThan(balance))
          throw new ConflictException('Payment exceeds remaining balance');
        return tx.payment.create({
          data: {
            enrollmentId,
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
