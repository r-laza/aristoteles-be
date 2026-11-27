import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AcademicCycleStatus,
  PaymentMethod,
  Prisma,
  ReceiptDocumentType,
  ReceiptRelationship,
} from '@prisma/client';
import { accountStatus, institutionToday, obligations } from './obligations';
import { PrismaService } from '../database/prisma.service';
import { CyclesService } from '../cycles/cycles.service';
import {
  safeFolderName,
  sanitizedStorageKey,
  StorageService,
} from '../storage/storage.service';

const NEW_PAYMENT_METHODS: readonly PaymentMethod[] = [
  PaymentMethod.CASH,
  PaymentMethod.TRANSFER,
  PaymentMethod.YAPE,
  PaymentMethod.PLIN,
];

function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > max)
    throw new BadRequestException();
  return value.trim() || null;
}

function payerData(input: Record<string, unknown>) {
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
  const relationship =
    input.payerRelationship === undefined || input.payerRelationship === ''
      ? null
      : input.payerRelationship;
  if (
    relationship !== null &&
    !Object.values(ReceiptRelationship).includes(
      relationship as ReceiptRelationship,
    )
  )
    throw new BadRequestException('Invalid payer relationship');
  const payerRelationshipOther =
    relationship === ReceiptRelationship.OTHER
      ? optionalText(input.payerRelationshipOther, 100)
      : null;
  return {
    payerName,
    payerDocumentType,
    payerDocumentNumber,
    payerRelationship: relationship as ReceiptRelationship | null,
    payerRelationshipOther,
  };
}
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly cycles: CyclesService,
  ) {}
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
        student: {
          select: {
            id: true,
            fullName: true,
            dni: true,
            representativeName: true,
            representativeDocumentType: true,
            representativeDocumentNumber: true,
            relationship: true,
            relationshipOther: true,
            primaryPhone: true,
          },
        },
        group: {
          select: { id: true, reusableGroup: { select: { name: true } } },
        },
        branch: { select: { id: true, name: true } },
        payments: {
          select: {
            amount: true,
            paymentType: true,
            period: true,
            paymentDate: true,
          },
          orderBy: { paymentDate: 'desc' },
        },
        pensionObligations: { orderBy: { period: 'asc' } },
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
      const overdueBalance = charges
        .filter(
          (charge) =>
            charge.balance.greaterThan(0) &&
            charge.dueDate !== null &&
            charge.dueDate < institutionToday(),
        )
        .reduce(
          (sum, charge) => sum.plus(charge.balance),
          new Prisma.Decimal(0),
        );
      return {
        id: enrollment.id,
        student: enrollment.student,
        group: {
          id: enrollment.group.id,
          name: enrollment.group.reusableGroup.name,
        },
        branch: enrollment.branch,
        cycle: enrollment.academicCycle.name,
        enrollmentFeeName:
          enrollment.enrollmentFeeName ?? enrollment.fee?.name ?? null,
        pensionName: enrollment.pensionName,
        pensionMonthlyAmount: enrollment.pensionAmount,
        baseAmount: enrollment.baseAmount,
        discountAmount: enrollment.discountAmount,
        obligations: charges,
        amountDue,
        amountPaid,
        balance,
        overdueBalance,
        lastPaymentDate: enrollment.payments[0]?.paymentDate ?? null,
        status: accountStatus(charges),
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
  async uploadEvidence(
    paymentId: number,
    file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException('Payment evidence is required');
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        paymentEvidenceKey: true,
        paymentEvidenceStorage: true,
        enrollment: {
          select: {
            studentId: true,
            student: { select: { fullName: true } },
            academicCycle: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!payment) throw new NotFoundException();
    const cycleId = payment.enrollment.academicCycle.id;
    const cycleName = payment.enrollment.academicCycle.name;
    const studentId = payment.enrollment.studentId;
    const studentName = payment.enrollment.student.fullName;
    const [otherCycles, otherStudents, counter] = await Promise.all([
      this.prisma.academicCycle.findMany({
        where: { id: { not: cycleId } },
        select: { name: true },
      }),
      this.prisma.student.findMany({
        where: {
          id: { not: studentId },
          academicEnrollments: { some: { academicCycleId: cycleId } },
        },
        select: { fullName: true },
      }),
      this.prisma.voucherCounter.upsert({
        where: {
          academicCycleId_studentId: {
            academicCycleId: cycleId,
            studentId,
          },
        },
        create: { academicCycleId: cycleId, studentId, lastValue: 1 },
        update: { lastValue: { increment: 1 } },
      }),
    ]);
    const duplicateCycleName = otherCycles.some(
      (cycle) => safeFolderName(cycle.name) === safeFolderName(cycleName),
    );
    const duplicateStudentName = otherStudents.some(
      (student) =>
        safeFolderName(student.fullName) === safeFolderName(studentName),
    );
    const uploaded = await this.storage.uploadPaymentEvidence(
      {
        cycleId,
        cycleName,
        duplicateCycleName,
        studentId,
        studentName,
        duplicateStudentName,
        sequence: counter.lastValue,
      },
      file,
    );
    const originalName = file.originalname
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .slice(0, 255);
    let updated;
    try {
      updated = await this.prisma.payment.update({
        where: { id: paymentId },
        data: {
          paymentEvidenceKey: uploaded.key,
          paymentEvidenceStorage: uploaded.location,
          paymentEvidenceOriginalName: originalName || 'evidence',
          paymentEvidenceMimeType: file.mimetype,
        },
      });
    } catch (error) {
      await this.storage.delete(uploaded.key, uploaded.location);
      throw error;
    }
    if (payment.paymentEvidenceKey) {
      try {
        await this.storage.delete(
          payment.paymentEvidenceKey,
          payment.paymentEvidenceStorage as 'local' | 's3' | null,
        );
      } catch (error) {
        // The database already points at the new voucher. Keep it accessible and
        // report the orphaned old object for operational cleanup.
        this.logger.error(
          `Failed to delete replaced voucher ${sanitizedStorageKey(payment.paymentEvidenceKey)}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    return updated;
  }

  async evidence(paymentId: number) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        paymentEvidenceKey: true,
        paymentEvidenceOriginalName: true,
        paymentEvidenceMimeType: true,
        paymentEvidenceStorage: true,
      },
    });
    if (
      !payment?.paymentEvidenceKey ||
      !payment.paymentEvidenceOriginalName ||
      !payment.paymentEvidenceMimeType
    )
      throw new NotFoundException();
    const stored = await this.storage.get(
      payment.paymentEvidenceKey,
      payment.paymentEvidenceStorage as 'local' | 's3' | null,
    );
    return {
      body: stored.body,
      mimeType: payment.paymentEvidenceMimeType,
      originalName: payment.paymentEvidenceOriginalName,
    };
  }
  async receipt(paymentId: number) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        enrollment: {
          include: {
            academicCycle: { select: { name: true } },
            student: { select: { fullName: true, primaryPhone: true } },
            group: {
              select: { reusableGroup: { select: { name: true } } },
            },
            fee: { select: { name: true } },
            pensionObligations: true,
          },
        },
      },
    });
    if (!payment?.receiptNumber) throw new NotFoundException();
    const pension = payment.paymentType === 'PENSION';
    const pensionObligation = pension
      ? payment.enrollment.pensionObligations.find(
          (item) => item.period === payment.period,
        )
      : null;
    return {
      paymentId: payment.id,
      receiptNumber: payment.receiptNumber,
      generatedAt: payment.receiptGeneratedAt,
      payer: {
        name: payment.payerName,
        documentType: payment.payerDocumentType,
        documentNumber: payment.payerDocumentNumber,
        relationship: payment.payerRelationship,
        relationshipOther: payment.payerRelationshipOther,
        phone: payment.enrollment.student.primaryPhone,
      },
      student: {
        name: payment.enrollment.student.fullName,
        group: payment.groupName ?? payment.enrollment.group.reusableGroup.name,
        branch: payment.branchName,
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
          ? (pensionObligation?.name ?? payment.enrollment.pensionName)
          : (payment.enrollment.enrollmentFeeName ??
            payment.enrollment.fee?.name),
        originalAmount: pension
          ? (pensionObligation?.baseAmount ??
            payment.enrollment.pensionBaseAmount)
          : payment.enrollment.baseAmount,
        discountAmount: pension
          ? (pensionObligation?.discountAmount ??
            payment.enrollment.pensionDiscountAmount ??
            0)
          : payment.enrollment.discountAmount,
        paidAmount: payment.amount,
      },
    };
  }
  async createReceipt(paymentId: number, body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new BadRequestException();
    const input = body as Record<string, unknown>;
    const payer = payerData(input);

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
          timeZone: 'America/Lima',
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
          ...payer,
          receiptNumber: `REC-${year}-${String(counter.lastValue).padStart(6, '0')}`,
          receiptGeneratedAt: new Date(),
        },
      });
    });
    return this.receipt(paymentId);
  }
  async register(
    enrollmentId: number,
    body: unknown,
    collectorId: number,
    transaction?: Prisma.TransactionClient,
  ) {
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
    if (!NEW_PAYMENT_METHODS.includes(input.paymentMethod as PaymentMethod))
      throw new BadRequestException('Invalid method');
    const paymentType = input.paymentType ?? 'ENROLLMENT';
    const periodPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
    const period = input.period ?? null;
    let requested: {
      paymentType: 'ENROLLMENT' | 'PENSION';
      period: string | null;
    }[];
    if (input.obligations !== undefined) {
      if (
        !Array.isArray(input.obligations) ||
        input.obligations.length === 0 ||
        input.obligations.length > 25 ||
        input.periods !== undefined
      )
        throw new BadRequestException('Invalid payment obligations');
      requested = input.obligations.map((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new BadRequestException('Invalid payment obligations');
        const obligation = value as Record<string, unknown>;
        const type = obligation.paymentType;
        const obligationPeriod = obligation.period ?? null;
        if (
          (type !== 'ENROLLMENT' && type !== 'PENSION') ||
          (type === 'ENROLLMENT' && obligationPeriod !== null) ||
          (type === 'PENSION' &&
            (typeof obligationPeriod !== 'string' ||
              !periodPattern.test(obligationPeriod)))
        )
          throw new BadRequestException('Invalid payment obligations');
        return {
          paymentType: type,
          period: obligationPeriod as string | null,
        };
      });
      if (
        new Set(
          requested.map((item) => `${item.paymentType}:${item.period ?? ''}`),
        ).size !== requested.length
      )
        throw new BadRequestException('Invalid payment obligations');
    } else if (input.periods !== undefined) {
      if (paymentType !== 'ENROLLMENT' && paymentType !== 'PENSION')
        throw new BadRequestException('Invalid payment type');
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
      requested = (input.periods as string[]).map((value) => ({
        paymentType: 'PENSION',
        period: value,
      }));
    } else {
      if (paymentType !== 'ENROLLMENT' && paymentType !== 'PENSION')
        throw new BadRequestException('Invalid payment type');
      if (
        (paymentType === 'ENROLLMENT' && period !== null) ||
        (paymentType === 'PENSION' &&
          (typeof period !== 'string' || !periodPattern.test(period)))
      )
        throw new BadRequestException('Invalid payment period');
      requested = [
        {
          paymentType: paymentType,
          period: period as string | null,
        },
      ];
    }
    const reference = optionalText(input.reference, 200),
      notes = optionalText(input.notes, 1000);
    const payer = payerData(input);
    const operation = async (tx: Prisma.TransactionClient) => {
        // Serialize payments for this enrollment so concurrent requests cannot overpay.
        const locked = await tx.$queryRaw<
          { id: number }[]
        >`SELECT "id" FROM "AcademicEnrollment" WHERE "id" = ${enrollmentId} FOR UPDATE`;
        if (!locked.length) throw new NotFoundException();
        const enrollment = await tx.enrollment.findUniqueOrThrow({
          where: { id: enrollmentId },
          include: {
            academicCycle: true,
            payments: true,
            pensionObligations: { orderBy: { period: 'asc' } },
            branch: true,
            group: { include: { reusableGroup: true } },
          },
        });
        if (enrollment.academicCycle.status !== AcademicCycleStatus.ACTIVE)
          throw new ConflictException('Academic cycle is not active');
        const charges = obligations(enrollment).filter((charge) =>
          requested.some(
            (item) =>
              item.paymentType === charge.paymentType &&
              item.period === charge.period,
          ),
        );
        if (charges.length !== requested.length)
          throw new BadRequestException('Payment obligation unavailable');
        if (charges.some((charge) => !charge.balance.greaterThan(0)))
          throw new ConflictException('Payment obligation unavailable');
        const balance = charges.reduce(
          (sum, charge) => sum.plus(charge.balance),
          new Prisma.Decimal(0),
        );
        if (amount.greaterThan(balance))
          throw new ConflictException('Payment exceeds remaining balance');
        if (requested.length > 1 && !amount.equals(balance))
          throw new BadRequestException(
            'Multiple installments require full payment',
          );
        const year = new Date().getUTCFullYear();
        const counter = await tx.receiptCounter.upsert({
          where: { year },
          create: { year, lastValue: charges.length },
          update: { lastValue: { increment: charges.length } },
        });
        const firstReceiptValue = counter.lastValue - charges.length + 1;
        const generatedAt = new Date();
        const payments = [];
        for (const [index, charge] of charges.entries()) {
          payments.push(
            await tx.payment.create({
              data: {
                enrollmentId,
                collectorId,
                registeredBranchId: enrollment.branchId,
                paymentType: charge.paymentType,
                period: charge.period,
                amount: requested.length > 1 ? charge.balance : amount,
                paymentDate,
                paymentMethod: input.paymentMethod as PaymentMethod,
                reference,
                notes,
                ...payer,
                receiptNumber: `REC-${year}-${String(firstReceiptValue + index).padStart(6, '0')}`,
                receiptGeneratedAt: generatedAt,
                branchName: enrollment.branch.name,
                groupName: enrollment.group.reusableGroup.name,
              },
            }),
          );
        }
        return {
          payments,
          totalAmount: amount,
          obligationCount: payments.length,
        };
    };
    return transaction
      ? operation(transaction)
      : this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        });
  }

  async registerInitial(
    cycleId: number,
    enrollmentBody: unknown,
    paymentBody: unknown,
    collectorId: number,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const enrollment = await this.cycles.enroll(
          cycleId,
          enrollmentBody,
          tx,
        );
        const registration = await this.register(
          enrollment.id,
          paymentBody,
          collectorId,
          tx,
        );
        return { ...registration, enrollmentId: enrollment.id };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
