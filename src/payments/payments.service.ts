import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PaymentMethod,
  Prisma,
  ReceiptDocumentType,
  ReceiptRelationship,
} from '@prisma/client';
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
        pensionBaseAmount: true,
        pensionDiscountAmount: true,
        pensionAmount: true,
        pensionDueDay: true,
        academicCycle: {
          select: { name: true, startDate: true, endDate: true },
        },
        student: { select: { id: true, fullName: true, dni: true } },
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
  async receipt(paymentId: number) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        enrollment: {
          include: {
            academicCycle: { select: { name: true } },
            student: { select: { fullName: true } },
            group: {
              select: { reusableGroup: { select: { name: true } } },
            },
            fee: { select: { name: true } },
          },
        },
      },
    });
    if (!payment?.receiptNumber) throw new NotFoundException();
    const pension = payment.paymentType === 'PENSION';
    return {
      paymentId: payment.id,
      receiptNumber: payment.receiptNumber,
      generatedAt: payment.receiptGeneratedAt,
      payer: {
        name: payment.payerName,
        documentType: payment.payerDocumentType,
        documentNumber: payment.payerDocumentNumber,
        relationship: payment.payerRelationship,
      },
      student: {
        name: payment.enrollment.student.fullName,
        group: payment.enrollment.group.reusableGroup.name,
        cycle: payment.enrollment.academicCycle.name,
      },
      payment: {
        date: payment.paymentDate,
        method: payment.paymentMethod,
        reference: payment.reference,
        amount: payment.amount,
      },
      obligation: {
        paymentType: payment.paymentType,
        period: payment.period,
        name: pension
          ? payment.enrollment.pensionName
          : (payment.enrollment.enrollmentFeeName ??
            payment.enrollment.fee.name),
        originalAmount: pension
          ? payment.enrollment.pensionBaseAmount
          : payment.enrollment.baseAmount,
        discountAmount: pension
          ? (payment.enrollment.pensionDiscountAmount ?? 0)
          : payment.enrollment.discountAmount,
        paidAmount: payment.amount,
      },
    };
  }
  async createReceipt(paymentId: number, body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new BadRequestException();
    const input = body as Record<string, unknown>;
    const payerName = optionalText(input.payerName, 150);
    const payerDocumentNumber = optionalText(input.payerDocumentNumber, 30);
    if (!payerName || !payerDocumentNumber)
      throw new BadRequestException('Missing payer information');
    if (
      !Object.values(ReceiptDocumentType).includes(
        input.payerDocumentType as ReceiptDocumentType,
      )
    )
      throw new BadRequestException('Invalid payer document type');
    const payerDocumentType = input.payerDocumentType as ReceiptDocumentType;
    const documentValid =
      payerDocumentType === ReceiptDocumentType.DNI
        ? /^\d{8}$/.test(payerDocumentNumber)
        : /^[A-Za-z0-9]{6,12}$/.test(payerDocumentNumber);
    if (!documentValid)
      throw new BadRequestException('Invalid payer document number');
    const payerRelationship =
      input.payerRelationship === undefined || input.payerRelationship === ''
        ? null
        : input.payerRelationship;
    if (
      payerRelationship !== null &&
      !Object.values(ReceiptRelationship).includes(
        payerRelationship as ReceiptRelationship,
      )
    )
      throw new BadRequestException('Invalid payer relationship');

    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        { id: number }[]
      >`SELECT "id" FROM "Payment" WHERE "id" = ${paymentId} FOR UPDATE`;
      if (!locked.length) throw new NotFoundException();
      const existing = await tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
        select: { receiptNumber: true },
      });
      if (existing.receiptNumber) return;
      const year = Number(
        new Intl.DateTimeFormat('en', {
          year: 'numeric',
          timeZone: 'America/Guayaquil',
        }).format(new Date()),
      );
      const counter = await tx.receiptCounter.upsert({
        where: { year },
        create: { year, lastValue: 1 },
        update: { lastValue: { increment: 1 } },
      });
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          payerName,
          payerDocumentType,
          payerDocumentNumber,
          payerRelationship: payerRelationship as ReceiptRelationship | null,
          receiptNumber: `REC-${year}-${String(counter.lastValue).padStart(6, '0')}`,
          receiptGeneratedAt: new Date(),
        },
      });
    });
    return this.receipt(paymentId);
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
    const periodPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
    const period = input.period ?? null;
    let periods: (string | null)[];
    if (input.periods !== undefined) {
      if (
        paymentType !== 'PENSION' ||
        period !== null ||
        !Array.isArray(input.periods) ||
        input.periods.length === 0 ||
        input.periods.length > 24 ||
        input.periods.some(
          (value) => typeof value !== 'string' || !periodPattern.test(value),
        ) ||
        new Set(input.periods).size !== input.periods.length
      )
        throw new BadRequestException('Invalid payment periods');
      periods = input.periods as string[];
    } else {
      if (
        (paymentType === 'ENROLLMENT' && period !== null) ||
        (paymentType === 'PENSION' &&
          (typeof period !== 'string' || !periodPattern.test(period)))
      )
        throw new BadRequestException('Invalid payment period');
      periods = [period as string | null];
    }
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
        const charges = obligations(enrollment).filter(
          (charge) =>
            charge.paymentType === paymentType &&
            periods.includes(charge.period),
        );
        if (charges.length !== periods.length)
          throw new BadRequestException('Payment obligation unavailable');
        if (charges.some((charge) => !charge.balance.greaterThan(0)))
          throw new ConflictException('Payment obligation unavailable');
        const balance = charges.reduce(
          (sum, charge) => sum.plus(charge.balance),
          new Prisma.Decimal(0),
        );
        if (amount.greaterThan(balance))
          throw new ConflictException('Payment exceeds remaining balance');
        if (periods.length > 1 && !amount.equals(balance))
          throw new BadRequestException(
            'Multiple installments require full payment',
          );
        const payments = [];
        for (const charge of charges) {
          payments.push(
            await tx.payment.create({
              data: {
                enrollmentId,
                paymentType,
                period: charge.period,
                amount: periods.length > 1 ? charge.balance : amount,
                paymentDate,
                paymentMethod: input.paymentMethod as PaymentMethod,
                reference,
                notes,
              },
            }),
          );
        }
        return {
          payments,
          totalAmount: amount,
          obligationCount: payments.length,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }
}
