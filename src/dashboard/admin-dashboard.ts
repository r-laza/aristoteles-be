import {
  AcademicCycleCategory,
  PaymentMethod,
  PaymentType,
  Prisma,
} from '@prisma/client';
import {
  accountStatus,
  cyclePeriods,
  institutionToday,
  obligations,
} from '../payments/obligations';

type DashboardEnrollment = Omit<
  Parameters<typeof obligations>[0],
  'payments'
> & {
  id: number;
  studentId: number;
  branch?: { id: number; name: string };
  group: { reusableGroup: { id: number; name: string } };
  payments: (Parameters<typeof obligations>[0]['payments'][number] & {
    id: number;
    paymentMethod: PaymentMethod;
    paymentDate: Date;
  })[];
};

export type ActiveCycleDashboardInput = {
  id: number;
  name: string;
  category: AcademicCycleCategory;
  startDate: Date;
  endDate: Date;
  enrollments: DashboardEnrollment[];
  branches?: { id: number; name: string }[];
  groupAssignments?: {
    branch: { id: number; name: string };
    group: { id: number; name: string };
  }[];
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
  const uniqueEnrollments = [
    ...new Map(
      cycle.enrollments.map((enrollment) => [enrollment.id, enrollment]),
    ).values(),
  ];
  const groups = new Map<
    number,
    { id: number; name: string; students: Set<number> }
  >();
  const methods = new Map<PaymentMethod, Prisma.Decimal>([
    [PaymentMethod.CASH, zero()],
    [PaymentMethod.TRANSFER, zero()],
    [PaymentMethod.YAPE, zero()],
    [PaymentMethod.PLIN, zero()],
  ]);
  let unrepresentedCollected = zero();
  const monthly = new Map<
    string,
    { enrollment: Prisma.Decimal; pension: Prisma.Decimal }
  >(
    cyclePeriods(cycle.startDate, cycle.endDate).map((period) => [
      period,
      { enrollment: zero(), pension: zero() },
    ]),
  );

  for (const source of uniqueEnrollments) {
    const enrollment = {
      ...source,
      payments: [
        ...new Map(
          source.payments.map((payment) => [payment.id, payment]),
        ).values(),
      ],
    };
    const group = enrollment.group.reusableGroup;
    const distribution = groups.get(group.id) ?? {
      ...group,
      students: new Set<number>(),
    };
    distribution.students.add(enrollment.studentId);
    groups.set(group.id, distribution);
    const charges = obligations(enrollment, today);
    outstanding = charges.reduce(
      (sum, charge) => sum.plus(charge.balance),
      outstanding,
    );
    overdueBalance = charges
      .filter(
        (charge) =>
          charge.balance.greaterThan(0) &&
          charge.dueDate !== null &&
          charge.dueDate < today,
      )
      .reduce((sum, charge) => sum.plus(charge.balance), overdueBalance);
    const status = accountStatus(charges, today);
    if (!['PAID', null].includes(status)) studentsWithDebt += 1;
    if (status === 'PENDING') pendingStudents += 1;
    if (status === 'OVERDUE') overdueStudents += 1;

    for (const payment of enrollment.payments) {
      const methodCollected = methods.get(payment.paymentMethod);
      if (methodCollected !== undefined)
        methods.set(
          payment.paymentMethod,
          methodCollected.plus(payment.amount),
        );
      else unrepresentedCollected = unrepresentedCollected.plus(payment.amount);
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
  const enrolledStudents = new Set(
    uniqueEnrollments.map((enrollment) => enrollment.studentId),
  ).size;
  const groupDistribution = [...groups.values()]
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name, 'es') || left.id - right.id,
    )
    .map(({ id, name, students }) => ({ id, name, count: students.size }));
  const comparisonBranches = cycle.branches ?? [];
  const comparisonGroups = new Map<
    number,
    { id: number; name: string; branchIds: Set<number> }
  >();
  for (const assignment of cycle.groupAssignments ?? []) {
    const group = comparisonGroups.get(assignment.group.id) ?? {
      ...assignment.group,
      branchIds: new Set<number>(),
    };
    group.branchIds.add(assignment.branch.id);
    comparisonGroups.set(group.id, group);
  }
  const comparisonCounts = new Map<string, Set<number>>();
  for (const enrollment of uniqueEnrollments) {
    if (!enrollment.branch) continue;
    const key = `${enrollment.group.reusableGroup.id}:${enrollment.branch.id}`;
    const students = comparisonCounts.get(key) ?? new Set<number>();
    students.add(enrollment.studentId);
    comparisonCounts.set(key, students);
  }
  const enrollmentComparison = {
    branches: comparisonBranches,
    rows: [...comparisonGroups.values()]
      .sort((left, right) => left.name.localeCompare(right.name, 'es'))
      .map((group) => {
        const counts = comparisonBranches.map((branch) => ({
          branchId: branch.id,
          count: group.branchIds.has(branch.id)
            ? (comparisonCounts.get(`${group.id}:${branch.id}`)?.size ?? 0)
            : 0,
        }));
        return {
          groupId: group.id,
          groupName: group.name,
          counts,
          total: counts.reduce((sum, item) => sum + item.count, 0),
        };
      }),
  };
  return {
    activeCycle: {
      id: cycle.id,
      name: cycle.name,
      startDate: cycle.startDate.toISOString().slice(0, 10),
      endDate: cycle.endDate.toISOString().slice(0, 10),
    },
    summary: {
      enrolledStudents,
      schoolEnrollments:
        cycle.category === AcademicCycleCategory.SCHOOL ? enrolledStudents : 0,
      preuniversityEnrollments:
        cycle.category === AcademicCycleCategory.PREUNIVERSITY
          ? enrolledStudents
          : 0,
      upToDateStudents: enrolledStudents - studentsWithDebt,
      studentsWithDebt,
      pendingStudents,
      overdueStudents,
      totalCollected: collected.toFixed(2),
      outstandingBalance: outstanding.toFixed(2),
      overdueBalance: overdueBalance.toFixed(2),
      enrollmentCollected: enrollmentCollected.toFixed(2),
      pensionCollected: pensionCollected.toFixed(2),
    },
    enrollmentDistribution: {
      school:
        cycle.category === AcademicCycleCategory.SCHOOL
          ? groupDistribution
          : [],
      preuniversity:
        cycle.category === AcademicCycleCategory.PREUNIVERSITY
          ? groupDistribution
          : [],
    },
    enrollmentComparison,
    paymentMethods: [...methods].map(([method, total]) => ({
      method,
      amount: total.toFixed(2),
    })),
    unrepresentedCollected: unrepresentedCollected.toFixed(2),
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
