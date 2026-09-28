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
    timeZone: 'America/Guayaquil',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
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

export function obligations(
  enrollment: {
    pensionStartDate?: Date | null;
    pensionEndDate?: Date | null;
    finalAmount: Prisma.Decimal;
    pensionAmount: Prisma.Decimal | null;
    pensionDueDay: number | null;
    academicCycle: { startDate: Date; endDate: Date };
    payments: {
      amount: Prisma.Decimal;
      paymentType: string;
      period: string | null;
    }[];
  },
  today = institutionToday(),
) {
  const definitions: {
    paymentType: 'ENROLLMENT' | 'PENSION';
    period: string | null;
    amount: Prisma.Decimal;
    dueDate: string | null;
  }[] = [
    {
      paymentType: 'ENROLLMENT',
      period: null,
      amount: enrollment.finalAmount,
      dueDate: null,
    },
  ];
  if (enrollment.pensionAmount !== null && enrollment.pensionDueDay !== null) {
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
