import { PaymentType, Prisma } from '@prisma/client';
import {
  accountStatus,
  cyclePeriods,
  institutionToday,
  obligations,
} from '../payments/obligations';

type DashboardEnrollment = Parameters<typeof obligations>[0] & {
  payments: (Parameters<typeof obligations>[0]['payments'][number] & {
    paymentDate: Date;
  })[];
};

export type ActiveCycleDashboardInput = {
  id: number;
  name: string;
  startDate: Date;
  endDate: Date;
  enrollments: DashboardEnrollment[];
};

const zero = () => new Prisma.Decimal(0);

export function aggregateAdminDashboard(
  cycle: ActiveCycleDashboardInput,
  today = institutionToday(),
) {
  let outstanding = zero();
  let overdueBalance = zero();
  let enrollmentCollected = zero();
  let pensionCollected = zero();
  let studentsWithDebt = 0;
  let pendingStudents = 0;
  let overdueStudents = 0;
  const monthly = new Map<
    string,
    { enrollment: Prisma.Decimal; pension: Prisma.Decimal }
  >(
    cyclePeriods(cycle.startDate, cycle.endDate).map((period) => [
      period,
      { enrollment: zero(), pension: zero() },
    ]),
  );

  for (const enrollment of cycle.enrollments) {
    const charges = obligations(enrollment, today);
    outstanding = charges.reduce(
      (sum, charge) => sum.plus(charge.balance),
      outstanding,
    );
    overdueBalance = charges
      .filter((charge) => charge.balance.greaterThan(0) && charge.dueDate !== null && charge.dueDate < today)
      .reduce((sum, charge) => sum.plus(charge.balance), overdueBalance);
    const status = accountStatus(charges, today);
    if (!['PAID', null].includes(status))
      studentsWithDebt += 1;
    if (status === 'PENDING') pendingStudents += 1;
    if (status === 'OVERDUE') overdueStudents += 1;

    for (const payment of enrollment.payments) {
      if (payment.paymentType === PaymentType.ENROLLMENT)
        enrollmentCollected = enrollmentCollected.plus(payment.amount);
      else pensionCollected = pensionCollected.plus(payment.amount);

      const period = payment.paymentDate.toISOString().slice(0, 7);
      const row = monthly.get(period) ?? {
        enrollment: zero(),
        pension: zero(),
      };
      if (payment.paymentType === PaymentType.ENROLLMENT)
        row.enrollment = row.enrollment.plus(payment.amount);
      else row.pension = row.pension.plus(payment.amount);
      monthly.set(period, row);
    }
  }

  const collected = enrollmentCollected.plus(pensionCollected);
  return {
    activeCycle: {
      id: cycle.id,
      name: cycle.name,
      startDate: cycle.startDate.toISOString().slice(0, 10),
      endDate: cycle.endDate.toISOString().slice(0, 10),
    },
    summary: {
      enrolledStudents: cycle.enrollments.length,
      upToDateStudents: cycle.enrollments.length - studentsWithDebt,
      studentsWithDebt,
      pendingStudents,
      overdueStudents,
      totalCollected: collected.toFixed(2),
      outstandingBalance: outstanding.toFixed(2),
      overdueBalance: overdueBalance.toFixed(2),
      enrollmentCollected: enrollmentCollected.toFixed(2),
      pensionCollected: pensionCollected.toFixed(2),
    },
    monthlyCollected: [...monthly.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([period, values]) => ({
        period,
        enrollment: values.enrollment.toFixed(2),
        pension: values.pension.toFixed(2),
        total: values.enrollment.plus(values.pension).toFixed(2),
      })),
  };
}

export function overdueSummary(
  enrollment: Parameters<typeof obligations>[0],
  today = institutionToday(),
) {
  const charges = obligations(enrollment, today).filter(
    (charge) =>
      charge.balance.greaterThan(0) &&
      charge.dueDate !== null &&
      charge.dueDate < today,
  );
  return {
    charges,
    balance: charges.reduce(
      (sum, charge) => sum.plus(charge.balance),
      new Prisma.Decimal(0),
    ),
  };
}

export function paginate<T>(items: T[], page: number, pageSize = 20) {
  return items.slice((page - 1) * pageSize, page * pageSize);
}
