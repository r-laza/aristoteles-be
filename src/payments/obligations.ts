import { Prisma } from '@prisma/client';

export function cyclePeriods(start: Date, end: Date) {
  const periods: string[] = [];
  const cursor = new Date(start);
  cursor.setUTCDate(1);
  while (cursor <= end) {
    periods.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return periods;
}

export function institutionToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function paymentPendingDays(value = process.env.PAYMENT_PENDING_DAYS) {
  if (value === undefined || value === '') return 7;
  if (!/^\d+$/.test(value))
    throw new Error('PAYMENT_PENDING_DAYS must be a non-negative integer');
  const days = Number(value);
  if (!Number.isSafeInteger(days))
    throw new Error('PAYMENT_PENDING_DAYS must be a non-negative integer');
  return days;
}

function calendarDatePlusDays(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return result.toISOString().slice(0, 10);
}

export function paymentStatus(
  balance: Prisma.Decimal,
  paid: Prisma.Decimal,
  overdue = false,
) {
  return balance.isZero()
    ? 'PAID'
    : overdue
      ? 'OVERDUE'
      : paid.isZero()
        ? 'PENDING'
        : 'PARTIAL';
}

// Account-level status shared by the dashboard and Gestión de pagos.
// Any overdue unpaid charge wins over future pending installments.
export function accountStatus(
  charges: ReturnType<typeof obligations>,
  today = institutionToday(),
  warningDays = paymentPendingDays(),
) {
  if (!charges.some((charge) => charge.amountDue.greaterThan(0))) return null;
  const pending = charges.filter((charge) => charge.balance.greaterThan(0));
  if (!pending.length) return 'PAID';
  if (
    pending.some((charge) => charge.dueDate !== null && charge.dueDate < today)
  )
    return 'OVERDUE';
  const warningThrough = calendarDatePlusDays(today, warningDays);
  if (pending.some((charge) => charge.dueDate === null || charge.dueDate <= warningThrough))
    return 'PENDING';
  return 'PAID';
}

export function obligations(
  enrollment: {
    pensionStartDate?: Date | null;
    pensionEndDate?: Date | null;
    finalAmount: Prisma.Decimal;
    baseAmount?: Prisma.Decimal;
    discountAmount?: Prisma.Decimal;
    pensionBaseAmount?: Prisma.Decimal | null;
    pensionDiscountAmount?: Prisma.Decimal | null;
    pensionAmount: Prisma.Decimal | null;
    pensionDueDay: number | null;
    academicCycle: { startDate: Date; endDate: Date };
    payments: {
      amount: Prisma.Decimal;
      paymentType: string;
      period: string | null;
    }[];
    pensionObligations?: {
      period: string;
      baseAmount: Prisma.Decimal;
      discountAmount: Prisma.Decimal;
      amount: Prisma.Decimal;
      dueDate: Date;
    }[];
  },
  today = institutionToday(),
) {
  const definitions: {
    paymentType: 'ENROLLMENT' | 'PENSION';
    period: string | null;
    amount: Prisma.Decimal;
    originalAmount: Prisma.Decimal;
    discountAmount: Prisma.Decimal;
    dueDate: string | null;
  }[] = [
    {
      paymentType: 'ENROLLMENT',
      period: null,
      amount: enrollment.finalAmount,
      originalAmount:
        enrollment.baseAmount ??
        enrollment.finalAmount.plus(enrollment.discountAmount ?? 0),
      discountAmount: enrollment.discountAmount ?? new Prisma.Decimal(0),
      dueDate: null,
    },
  ];
  if (enrollment.pensionObligations?.length) {
    for (const obligation of enrollment.pensionObligations) {
      definitions.push({
        paymentType: 'PENSION', period: obligation.period,
        amount: obligation.amount, originalAmount: obligation.baseAmount,
        discountAmount: obligation.discountAmount,
        dueDate: obligation.dueDate.toISOString().slice(0, 10),
      });
    }
  } else if (enrollment.pensionAmount !== null && enrollment.pensionDueDay !== null) {
    for (const period of cyclePeriods(
      enrollment.pensionStartDate ?? enrollment.academicCycle.startDate,
      enrollment.pensionEndDate ?? enrollment.academicCycle.endDate,
    )) {
      const [year, month] = period.split('-').map(Number);
      const day = Math.min(
        enrollment.pensionDueDay,
        new Date(Date.UTC(year, month, 0)).getUTCDate(),
      );
      definitions.push({
        paymentType: 'PENSION',
        period,
        amount: enrollment.pensionAmount,
        originalAmount:
          enrollment.pensionBaseAmount ?? enrollment.pensionAmount,
        discountAmount:
          enrollment.pensionDiscountAmount ?? new Prisma.Decimal(0),
        dueDate: `${period}-${String(day).padStart(2, '0')}`,
      });
    }
  }
  return definitions.map(({ amount: amountDue, ...definition }) => {
    const amountPaid = enrollment.payments
      .filter(
        (p) =>
          p.paymentType === definition.paymentType &&
          p.period === definition.period,
      )
      .reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0));
    const balance = amountDue.minus(amountPaid);
    return {
      ...definition,
      amountDue,
      amountPaid,
      balance,
      status: paymentStatus(
        balance,
        amountPaid,
        !!definition.dueDate && definition.dueDate < today,
      ),
    };
  });
}
