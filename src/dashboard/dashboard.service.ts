import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AcademicCycleStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { DashboardDto } from './dashboard.types';
import {
  accountStatus,
  institutionToday,
  obligations,
} from '../payments/obligations';
import { aggregateAdminDashboard, paginate } from './admin-dashboard';
import { overdueStudentsWorkbook } from './dashboard-overdue-export';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  private async filters(input: {
    branchId?: number;
    cycleId?: number;
    groupId?: number;
  }) {
    const branches = await this.prisma.branch.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true },
    });
    if (!branches.length)
      return {
        branches,
        branch: null,
        cycles: [],
        selectedCycleId: undefined,
        cycleIds: [],
        groups: [],
        groupId: undefined,
      };
    const branch =
      input.branchId === undefined
        ? branches[0]
        : branches.find((item) => item.id === input.branchId);
    if (!branch) throw new NotFoundException('Branch not found');
    const cycles = await this.prisma.academicCycle.findMany({
      where: { branches: { some: { branchId: branch.id } } },
      orderBy: [{ startDate: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        name: true,
        status: true,
        category: true,
        startDate: true,
        endDate: true,
      },
    });
    if (
      input.cycleId !== undefined &&
      !cycles.some((cycle) => cycle.id === input.cycleId)
    )
      throw new NotFoundException('Cycle not found for branch');
    const selectedCycleId =
      input.cycleId ??
      cycles.find((cycle) => cycle.status === AcademicCycleStatus.ACTIVE)?.id ??
      cycles[0]?.id;
    const cycleIds = selectedCycleId === undefined ? [] : [selectedCycleId];
    const cycleGroups = cycleIds.length
      ? await this.prisma.cycleGroup.findMany({
          where: { academicCycleId: { in: cycleIds }, branchId: branch.id },
          orderBy: { reusableGroup: { name: 'asc' } },
          select: { reusableGroup: { select: { id: true, name: true } } },
        })
      : [];
    const groupOptions = [
      ...new Map(
        cycleGroups.map((item) => [item.reusableGroup.id, item.reusableGroup]),
      ).values(),
    ];
    if (
      input.groupId !== undefined &&
      !groupOptions.some((group) => group.id === input.groupId)
    )
      throw new NotFoundException('Group not found for selection');
    return {
      branches,
      branch,
      cycles,
      selectedCycleId,
      cycleIds,
      groups: groupOptions,
      groupId: input.groupId,
    };
  }

  private enrollmentWhere(
    filters: Awaited<ReturnType<DashboardService['filters']>>,
  ) {
    return {
      branchId: filters.branch!.id,
      academicCycleId: { in: filters.cycleIds },
      ...(filters.groupId === undefined
        ? {}
        : { group: { reusableGroupId: filters.groupId } }),
    };
  }

  private enrollmentFinancialSelect() {
    return {
      id: true,
      finalAmount: true,
      baseAmount: true,
      discountAmount: true,
      pensionStartDate: true,
      pensionEndDate: true,
      pensionBaseAmount: true,
      pensionDiscountAmount: true,
      pensionAmount: true,
      pensionDueDay: true,
      academicCycle: {
        select: { id: true, name: true, startDate: true, endDate: true },
      },
      pensionObligations: true,
      payments: {
        select: {
          id: true,
          amount: true,
          paymentType: true,
          period: true,
          paymentDate: true,
          paymentMethod: true,
        },
      },
    } as const;
  }

  async getAdminDashboard(
    input: { branchId?: number; cycleId?: number; groupId?: number } = {},
  ) {
    const today = institutionToday();
    const filters = await this.filters(input);
    const metadata = {
      branches: filters.branches,
      selectedBranchId: filters.branch?.id ?? null,
      cycles: filters.cycles.map(({ id, name, status }) => ({
        id,
        name,
        status,
      })),
      selectedCycleId: filters.selectedCycleId ?? null,
      groups: filters.groups,
      selectedGroupId: input.groupId ?? null,
    };
    if (!filters.branch || !filters.cycleIds.length)
      return { ...metadata, dashboard: null };
    const enrollments = await this.prisma.enrollment.findMany({
      where: this.enrollmentWhere(filters),
      select: {
        ...this.enrollmentFinancialSelect(),
        studentId: true,
        group: {
          select: { reusableGroup: { select: { id: true, name: true } } },
        },
      },
    });
    const selectedCycles = filters.cycles.filter((cycle) =>
      filters.cycleIds.includes(cycle.id),
    );
    const startDate = new Date(
      Math.min(...selectedCycles.map((cycle) => cycle.startDate.getTime())),
    );
    const endDate = new Date(
      Math.max(...selectedCycles.map((cycle) => cycle.endDate.getTime())),
    );
    const aggregate = aggregateAdminDashboard(
      {
        id: selectedCycles[0].id,
        name: selectedCycles[0].name,
        category: selectedCycles[0].category,
        startDate,
        endDate,
        enrollments,
      },
      today,
    );
    return { ...metadata, dashboard: aggregate };
  }

  async payments(input: {
    branchId?: number;
    cycleId?: number;
    groupId?: number;
    page: number;
    search: string;
  }) {
    return this.studentFinancialRows(input, { status: 'PAID' });
  }

  async debtors(input: {
    branchId?: number;
    cycleId?: number;
    groupId?: number;
    page: number;
    search: string;
  }) {
    return this.studentFinancialRows(input, { status: 'OVERDUE' });
  }

  async pending(input: {
    branchId?: number;
    cycleId?: number;
    groupId?: number;
    page: number;
    search: string;
  }) {
    return this.studentFinancialRows(input, { status: 'PENDING' });
  }

  async overdueExport(input: {
    branchId?: number;
    cycleId?: number;
    groupId?: number;
    search: string;
  }) {
    const filters = await this.filters(input);
    if (!filters.branch || !filters.cycleIds.length)
      return overdueStudentsWorkbook([]);
    const search = input.search.trim();
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        ...this.enrollmentWhere(filters),
        ...(search
          ? {
              student: {
                OR: [
                  {
                    fullName: {
                      contains: search,
                      mode: 'insensitive' as const,
                    },
                  },
                  { dni: { contains: search } },
                ],
              },
            }
          : {}),
      },
      select: {
        ...this.enrollmentFinancialSelect(),
        studentId: true,
        student: {
          select: {
            fullName: true,
            dni: true,
            representativeName: true,
            relationship: true,
            relationshipOther: true,
            primaryPhone: true,
          },
        },
        branch: { select: { name: true } },
        group: { select: { reusableGroup: { select: { name: true } } } },
      },
    });
    const today = institutionToday();
    const relationship = (value: string, other: string | null) =>
      value === 'OTHER'
        ? (other ?? '')
        : ({ FATHER: 'Padre', MOTHER: 'Madre', GUARDIAN: 'Apoderado' }[value] ??
          value);
    const unique = new Map<
      number,
      Parameters<typeof overdueStudentsWorkbook>[0][number]
    >();
    for (const enrollment of enrollments) {
      const charges = obligations(enrollment, today);
      if (accountStatus(charges, today) !== 'OVERDUE') continue;
      const unpaid = charges.filter((charge) => charge.balance.greaterThan(0));
      const overdue = unpaid.filter(
        (charge) => charge.dueDate !== null && charge.dueDate < today,
      );
      const nextDueDate =
        unpaid
          .flatMap((charge) => (charge.dueDate ? [charge.dueDate] : []))
          .sort()[0] ?? null;
      unique.set(enrollment.studentId, {
        studentId: enrollment.studentId,
        studentName: enrollment.student.fullName,
        dni: enrollment.student.dni,
        branch: enrollment.branch.name,
        cycle: enrollment.academicCycle.name,
        group: enrollment.group.reusableGroup.name,
        representativeName: enrollment.student.representativeName ?? '',
        relationship: relationship(
          enrollment.student.relationship,
          enrollment.student.relationshipOther,
        ),
        whatsapp: enrollment.student.primaryPhone?.trim() || '',
        outstandingBalance: Number(
          unpaid
            .reduce(
              (sum, charge) => sum.plus(charge.balance),
              new Prisma.Decimal(0),
            )
            .toFixed(2),
        ),
        overdueBalance: Number(
          overdue
            .reduce(
              (sum, charge) => sum.plus(charge.balance),
              new Prisma.Decimal(0),
            )
            .toFixed(2),
        ),
        overdueInstallments: overdue.length,
        nextDueDate,
      });
    }
    return overdueStudentsWorkbook([...unique.values()]);
  }

  private async studentFinancialRows(
    input: {
      branchId?: number;
      cycleId?: number;
      groupId?: number;
      page: number;
      search: string;
    },
    selection: { status: 'PAID' | 'PENDING' | 'OVERDUE' },
  ) {
    if (input.page < 1) throw new BadRequestException('Invalid page');
    const filters = await this.filters(input);
    if (!filters.branch || !filters.cycleIds.length)
      return { items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 };
    const search = input.search.trim();
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        ...this.enrollmentWhere(filters),
        ...(search
          ? {
              student: {
                OR: [
                  {
                    fullName: {
                      contains: search,
                      mode: 'insensitive' as const,
                    },
                  },
                  { dni: { contains: search } },
                ],
              },
            }
          : {}),
      },
      select: {
        ...this.enrollmentFinancialSelect(),
        student: { select: { id: true, fullName: true, dni: true } },
        group: { select: { reusableGroup: { select: { name: true } } } },
      },
    });
    const today = institutionToday();
    const rows = enrollments
      .flatMap((enrollment) => {
        const charges = obligations(enrollment, today);
        const status = accountStatus(charges, today) ?? 'PAID';
        if (status !== selection.status) return [];
        const totalPaid = charges.reduce(
          (sum, charge) => sum.plus(charge.amountPaid),
          new Prisma.Decimal(0),
        );
        const outstandingBalance = charges.reduce(
          (sum, charge) => sum.plus(charge.balance),
          new Prisma.Decimal(0),
        );
        return [
          {
            enrollmentId: enrollment.id,
            studentId: enrollment.student.id,
            student: enrollment.student,
            group: enrollment.group.reusableGroup.name,
            totalPaid: totalPaid.toFixed(2),
            outstandingBalance: outstandingBalance.toFixed(2),
            status,
          },
        ];
      })
      .sort(
        (left, right) =>
          Number(right.outstandingBalance) - Number(left.outstandingBalance),
      );
    const pageSize = 20,
      total = rows.length;
    return {
      items: paginate(rows, input.page, pageSize),
      page: input.page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async debtorDetail(
    enrollmentId: number,
    input: { branchId?: number; cycleId?: number; groupId?: number },
  ) {
    const filters = await this.filters(input);
    if (!filters.branch || !filters.cycleIds.length)
      throw new NotFoundException();
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { id: enrollmentId, ...this.enrollmentWhere(filters) },
      select: {
        ...this.enrollmentFinancialSelect(),
        branch: { select: { name: true } },
        group: { select: { reusableGroup: { select: { name: true } } } },
        student: {
          select: {
            fullName: true,
            dni: true,
            representativeName: true,
            relationship: true,
            relationshipOther: true,
            primaryPhone: true,
          },
        },
      },
    });
    if (!enrollment) throw new NotFoundException();
    const today = institutionToday();
    const charges = obligations(enrollment, today);
    const unpaid = charges.filter((charge) => charge.balance.greaterThan(0));
    const total = unpaid.reduce(
      (sum, charge) => sum.plus(charge.balance),
      new Prisma.Decimal(0),
    );
    const overdue = unpaid.filter(
      (charge) => charge.dueDate !== null && charge.dueDate < today,
    );
    const overdueTotal = overdue.reduce(
      (sum, charge) => sum.plus(charge.balance),
      new Prisma.Decimal(0),
    );
    const totalPaid = charges.reduce(
      (sum, charge) => sum.plus(charge.amountPaid),
      new Prisma.Decimal(0),
    );
    return {
      enrollmentId: enrollment.id,
      student: enrollment.student,
      branch: enrollment.branch.name,
      cycle: enrollment.academicCycle.name,
      group: enrollment.group.reusableGroup.name,
      totalPaid: totalPaid.toFixed(2),
      totalOwed: total.toFixed(2),
      overdueBalance: overdueTotal.toFixed(2),
      asOfDate: today,
      installments: charges.map((charge) => ({
        paymentType: charge.paymentType,
        period: charge.period,
        dueDate: charge.dueDate,
        amountDue: charge.amountDue.toFixed(2),
        amountPaid: charge.amountPaid.toFixed(2),
        balance: charge.balance.toFixed(2),
        overdue:
          charge.balance.greaterThan(0) &&
          charge.dueDate !== null &&
          charge.dueDate < today,
      })),
      payments: enrollment.payments
        .sort((a, b) => b.paymentDate.getTime() - a.paymentDate.getTime())
        .map((payment) => ({
          id: payment.id,
          date: payment.paymentDate.toISOString().slice(0, 10),
          amount: payment.amount.toFixed(2),
          paymentType: payment.paymentType,
          period: payment.period,
          method: payment.paymentMethod,
        })),
    };
  }

  async studentFinancialDetail(
    studentId: number,
    input: { cycleId: number; branchId?: number; groupId?: number },
  ) {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: {
        studentId,
        academicCycleId: input.cycleId,
        ...(input.branchId === undefined ? {} : { branchId: input.branchId }),
        ...(input.groupId === undefined
          ? {}
          : { group: { reusableGroupId: input.groupId } }),
      },
      select: { id: true, branchId: true },
    });
    if (!enrollment) throw new NotFoundException();
    return this.debtorDetail(enrollment.id, {
      cycleId: input.cycleId,
      branchId: input.branchId ?? enrollment.branchId,
      groupId: input.groupId,
    });
  }

  async getDashboard(): Promise<DashboardDto> {
    const student = await this.prisma.student.findFirst({
      where: { fullName: 'Carlos Sánchez' },
      include: {
        enrollments: {
          include: {
            course: true,
          },
        },
      },
    });

    if (!student) {
      throw new Error('Student not found');
    }

    const courses = student.enrollments.map((enrollment) => ({
      id: enrollment.course.id,
      name: enrollment.course.name,
      teacher: enrollment.course.teacher,
      progress: enrollment.progress,
      image: enrollment.course.image,
    }));

    const pendingTasks = await this.prisma.task.findMany({
      where: { status: 'pending' },
      orderBy: { dueAt: 'asc' },
      include: { course: true },
      take: 4,
    });

    const nextClass = courses[0] ?? {
      name: 'Sin clases',
      teacher: '',
      progress: 0,
      image: '',
      id: 0,
    };
    const nextClassDate = pendingTasks[0]?.dueAt ?? new Date();

    const recentActivity = await this.prisma.activity.findMany({
      where: { studentId: student.id },
      orderBy: { createdAt: 'desc' },
      include: { course: true },
      take: 4,
    });

    return {
      student: {
        id: student.id,
        name: student.fullName,
        initials: student.initials,
      },
      summary: {
        activeCourses: courses.length,
        pendingTasks: pendingTasks.length,
        nextClass: {
          course: nextClass.name,
          startsAt: nextClassDate.toISOString(),
        },
      },
      courses,
      upcomingTasks: pendingTasks.map((task) => ({
        id: task.id,
        title: task.title,
        course: task.course.name,
        dueAt: task.dueAt.toISOString(),
      })),
      recentActivity: recentActivity.map((item) => ({
        id: item.id,
        title: item.title,
        course: item.course?.name ?? 'General',
        createdAt: item.createdAt.toISOString(),
      })),
    };
  }
}
