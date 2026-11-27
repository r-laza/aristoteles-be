import {
  AcademicCycleCategory,
  PaymentMethod,
  PaymentType,
  Prisma,
} from '@prisma/client';
import {
  aggregateAdminDashboard,
  overdueSummary,
  paginate,
} from './admin-dashboard';
import { DashboardService } from './dashboard.service';

const decimal = (value: string | number) => new Prisma.Decimal(value);

describe('Admin dashboard aggregation', () => {
  it('returns a clean empty result when no cycle is active', async () => {
    const service = new DashboardService({
      branch: { findMany: jest.fn().mockResolvedValue([]) },
    } as never);
    await expect(service.getAdminDashboard()).resolves.toMatchObject({
      selectedBranchId: null,
      dashboard: null,
    });
  });

  it('validates an explicitly selected cycle', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new DashboardService({
      branch: {
        findMany: jest.fn().mockResolvedValue([{ id: 1, name: 'Centro' }]),
      },
      academicCycle: { findMany },
    } as never);
    await expect(
      service.getAdminDashboard({ cycleId: 99 }),
    ).rejects.toMatchObject({
      status: 404,
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { branches: { some: { branchId: 1 } } },
      }),
    );
  });

  it('returns every cycle status and defaults to an active cycle', async () => {
    const cycles = [
      {
        id: 3,
        name: 'Cerrado',
        status: 'CLOSED',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-03-01'),
      },
      {
        id: 2,
        name: 'Activo',
        status: 'ACTIVE',
        startDate: new Date('2026-04-01'),
        endDate: new Date('2026-12-01'),
      },
      {
        id: 1,
        name: 'Próximo',
        status: 'UPCOMING',
        startDate: new Date('2027-01-01'),
        endDate: new Date('2027-03-01'),
      },
    ];
    const service = new DashboardService({
      branch: {
        findMany: jest.fn().mockResolvedValue([{ id: 8, name: 'Centro' }]),
      },
      academicCycle: { findMany: jest.fn().mockResolvedValue(cycles) },
      cycleGroup: { findMany: jest.fn().mockResolvedValue([]) },
      enrollment: { findMany: jest.fn().mockResolvedValue([]) },
    } as never);
    const result = await service.getAdminDashboard();
    expect(result.selectedBranchId).toBe(8);
    expect(result.selectedCycleId).toBe(2);
    expect(result.cycles.map((cycle) => cycle.status)).toEqual([
      'CLOSED',
      'ACTIVE',
      'UPCOMING',
    ]);
    expect(result.dashboard?.activeCycle.name).toBe('Activo');
  });

  it('allows a closed cycle to be selected for historical reporting', async () => {
    const closed = {
      id: 3,
      name: 'Histórico',
      status: 'CLOSED',
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-03-01'),
    };
    const service = new DashboardService({
      branch: {
        findMany: jest.fn().mockResolvedValue([{ id: 1, name: 'Centro' }]),
      },
      academicCycle: { findMany: jest.fn().mockResolvedValue([closed]) },
      cycleGroup: { findMany: jest.fn().mockResolvedValue([]) },
      enrollment: { findMany: jest.fn().mockResolvedValue([]) },
    } as never);
    const result = await service.getAdminDashboard({ cycleId: 3 });
    expect(result.selectedCycleId).toBe(3);
    expect(result.dashboard?.activeCycle.name).toBe('Histórico');
  });

  it('aggregates only supplied cycle enrollments and actual payments', () => {
    const result = aggregateAdminDashboard(
      {
        id: 7,
        name: '2027-A',
        category: AcademicCycleCategory.SCHOOL,
        startDate: new Date('2027-01-15T00:00:00.000Z'),
        endDate: new Date('2027-03-31T00:00:00.000Z'),
        enrollments: [
          {
            id: 1,
            studentId: 11,
            group: { reusableGroup: { id: 5, name: 'Kids' } },
            finalAmount: decimal(100),
            pensionAmount: decimal(50),
            pensionDueDay: 10,
            academicCycle: {
              startDate: new Date('2027-01-15T00:00:00.000Z'),
              endDate: new Date('2027-03-31T00:00:00.000Z'),
            },
            payments: [
              {
                id: 10,
                paymentMethod: PaymentMethod.CASH,
                amount: decimal(100),
                paymentType: PaymentType.ENROLLMENT,
                period: null,
                paymentDate: new Date('2027-01-20T00:00:00.000Z'),
              },
              {
                id: 11,
                paymentMethod: PaymentMethod.YAPE,
                amount: decimal(50),
                paymentType: PaymentType.PENSION,
                period: '2027-01',
                paymentDate: new Date('2027-02-01T00:00:00.000Z'),
              },
            ],
          },
          {
            id: 2,
            studentId: 12,
            group: { reusableGroup: { id: 6, name: 'Tigres' } },
            finalAmount: decimal(80),
            pensionAmount: null,
            pensionDueDay: null,
            academicCycle: {
              startDate: new Date('2027-01-15T00:00:00.000Z'),
              endDate: new Date('2027-03-31T00:00:00.000Z'),
            },
            payments: [],
          },
        ],
      },
      '2027-01-25',
    );

    expect(result.summary).toEqual({
      enrolledStudents: 2,
      schoolEnrollments: 2,
      preuniversityEnrollments: 0,
      upToDateStudents: 1,
      pendingStudents: 1,
      overdueStudents: 0,
      studentsWithDebt: 1,
      totalCollected: '150.00',
      outstandingBalance: '180.00',
      overdueBalance: '0.00',
      enrollmentCollected: '100.00',
      pensionCollected: '50.00',
    });
    expect(result.monthlyCollected).toEqual([
      {
        period: '2027-01',
        enrollment: '100.00',
        pension: '0.00',
        total: '100.00',
      },
      {
        period: '2027-02',
        enrollment: '0.00',
        pension: '50.00',
        total: '50.00',
      },
      { period: '2027-03', enrollment: '0.00', pension: '0.00', total: '0.00' },
    ]);
    expect(result.enrollmentDistribution).toEqual({
      school: [
        { id: 5, name: 'Kids', count: 1 },
        { id: 6, name: 'Tigres', count: 1 },
      ],
      preuniversity: [],
    });
    expect(result.paymentMethods).toEqual([
      { method: 'CASH', amount: '100.00' },
      { method: 'TRANSFER', amount: '0.00' },
      { method: 'YAPE', amount: '50.00' },
      { method: 'PLIN', amount: '0.00' },
    ]);
  });

  it('counts preuniversity enrollments once while summing distinct partial payments exactly', () => {
    const cycle = {
      id: 3,
      name: 'Preuniversitario',
      category: AcademicCycleCategory.PREUNIVERSITY,
      startDate: new Date('2027-01-01'),
      endDate: new Date('2027-03-31'),
    };
    const payments = [
      {
        id: 1,
        amount: decimal('30.25'),
        paymentMethod: PaymentMethod.TRANSFER,
        paymentType: PaymentType.ENROLLMENT,
        period: null,
        paymentDate: new Date('2027-01-05'),
      },
      {
        id: 2,
        amount: decimal('19.75'),
        paymentMethod: PaymentMethod.PLIN,
        paymentType: PaymentType.ENROLLMENT,
        period: null,
        paymentDate: new Date('2027-02-05'),
      },
    ];
    const enrollment = {
      id: 7,
      studentId: 8,
      group: { reusableGroup: { id: 9, name: 'Medicina' } },
      finalAmount: decimal(100),
      pensionAmount: null,
      pensionDueDay: null,
      academicCycle: cycle,
      payments: [...payments, payments[0]],
    };
    const result = aggregateAdminDashboard(
      { ...cycle, enrollments: [enrollment, enrollment] },
      '2027-02-10',
    );
    expect(result.summary).toMatchObject({
      enrolledStudents: 1,
      schoolEnrollments: 0,
      preuniversityEnrollments: 1,
      totalCollected: '50.00',
      outstandingBalance: '50.00',
    });
    expect(result.enrollmentDistribution).toEqual({
      school: [],
      preuniversity: [{ id: 9, name: 'Medicina', count: 1 }],
    });
    expect(result.paymentMethods).toEqual([
      { method: 'CASH', amount: '0.00' },
      { method: 'TRANSFER', amount: '30.25' },
      { method: 'YAPE', amount: '0.00' },
      { method: 'PLIN', amount: '19.75' },
    ]);
    expect(
      result.monthlyCollected
        .reduce((sum, month) => sum.plus(month.total), decimal(0))
        .toFixed(2),
    ).toBe('50.00');
  });

  it('retains historical-method revenue without misclassifying it as a supported method', () => {
    const cycle = {
      id: 3,
      name: 'Escolar',
      category: AcademicCycleCategory.SCHOOL,
      startDate: new Date('2027-01-01'),
      endDate: new Date('2027-03-31'),
    };
    const result = aggregateAdminDashboard({
      ...cycle,
      enrollments: [
        {
          id: 1,
          studentId: 1,
          group: { reusableGroup: { id: 2, name: 'Kids' } },
          finalAmount: decimal(100),
          pensionAmount: null,
          pensionDueDay: null,
          academicCycle: cycle,
          payments: [
            {
              id: 1,
              amount: decimal(20),
              paymentMethod: PaymentMethod.CARD,
              paymentType: PaymentType.ENROLLMENT,
              period: null,
              paymentDate: new Date('2027-01-05'),
            },
          ],
        },
      ],
    });
    expect(result.summary.totalCollected).toBe('20.00');
    expect(result.unrepresentedCollected).toBe('20.00');
    expect(result.paymentMethods.map((method) => method.amount)).toEqual([
      '0.00',
      '0.00',
      '0.00',
      '0.00',
    ]);
  });

  it('scopes group analytics and payments to the selected branch and cycle relationships', async () => {
    const findMany = jest
      .fn<Promise<never[]>, [Prisma.EnrollmentFindManyArgs]>()
      .mockResolvedValue([]);
    const cycle = {
      id: 2,
      name: 'Escolar',
      category: AcademicCycleCategory.SCHOOL,
      status: 'ACTIVE',
      startDate: new Date('2027-01-01'),
      endDate: new Date('2027-12-01'),
    };
    const cycleGroups = jest
      .fn()
      .mockResolvedValue([{ reusableGroup: { id: 3, name: 'Kids' } }]);
    const service = new DashboardService({
      branch: {
        findMany: jest.fn().mockResolvedValue([
          { id: 1, name: 'Centro' },
          { id: 8, name: 'Huánuco' },
        ]),
      },
      academicCycle: { findMany: jest.fn().mockResolvedValue([cycle]) },
      cycleGroup: { findMany: cycleGroups },
      enrollment: { findMany },
    } as never);
    const result = await service.getAdminDashboard({
      branchId: 8,
      cycleId: 2,
      groupId: 3,
    });
    expect(result).toMatchObject({
      selectedBranchId: 8,
      selectedCycleId: 2,
      selectedGroupId: 3,
    });
    expect(cycleGroups).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { academicCycleId: { in: [2] }, branchId: 8 },
      }),
    );
    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: {
        branchId: 8,
        academicCycleId: { in: [2] },
        group: { reusableGroupId: 3 },
      },
      select: {
        studentId: true,
        group: {
          select: { reusableGroup: { select: { id: true, name: true } } },
        },
        payments: {
          select: {
            id: true,
            amount: true,
            paymentMethod: true,
          },
        },
      },
    });
    expect(result.dashboard?.enrollmentDistribution).toEqual({
      school: [],
      preuniversity: [],
    });
    await expect(
      service.getAdminDashboard({ branchId: 8, cycleId: 2, groupId: 99 }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('distinguishes overdue installments from future unpaid installments', () => {
    const result = overdueSummary(
      {
        finalAmount: decimal(0),
        pensionAmount: decimal(100),
        pensionDueDay: 10,
        academicCycle: {
          startDate: new Date('2027-01-01T00:00:00.000Z'),
          endDate: new Date('2027-03-31T00:00:00.000Z'),
        },
        payments: [],
      },
      '2027-02-05',
    );
    expect(result.charges.map((charge) => charge.period)).toEqual(['2027-01']);
    expect(result.balance.toFixed(2)).toBe('100.00');
  });

  it('paginates debtor results in pages of twenty', () => {
    expect(
      paginate(
        Array.from({ length: 45 }, (_, index) => index + 1),
        2,
      ),
    ).toEqual(Array.from({ length: 20 }, (_, index) => index + 21));
  });

  it('groups multiple payments into exactly one student row', async () => {
    const cycle = {
      id: 2,
      name: 'Escolar',
      status: 'ACTIVE',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-03-31'),
    };
    const service = new DashboardService({
      branch: {
        findMany: jest.fn().mockResolvedValue([{ id: 1, name: 'Centro' }]),
      },
      academicCycle: { findMany: jest.fn().mockResolvedValue([cycle]) },
      cycleGroup: { findMany: jest.fn().mockResolvedValue([]) },
      enrollment: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 10,
            finalAmount: decimal(100),
            baseAmount: decimal(100),
            discountAmount: decimal(0),
            pensionStartDate: null,
            pensionEndDate: null,
            pensionBaseAmount: null,
            pensionDiscountAmount: null,
            pensionAmount: null,
            pensionDueDay: null,
            pensionObligations: [],
            academicCycle: cycle,
            student: { id: 77, fullName: 'Alex Pérez', dni: '12345678' },
            group: { reusableGroup: { name: 'A' } },
            payments: [
              {
                id: 1,
                amount: decimal(30),
                paymentType: PaymentType.ENROLLMENT,
                period: null,
                paymentDate: new Date('2026-01-01'),
                paymentMethod: 'CASH',
              },
              {
                id: 2,
                amount: decimal(70),
                paymentType: PaymentType.ENROLLMENT,
                period: null,
                paymentDate: new Date('2026-01-02'),
                paymentMethod: 'CASH',
              },
            ],
          },
        ]),
      },
    } as never);
    const result = await service.payments({ page: 1, search: '' });
    expect(result.total).toBe(1);
    expect(result.items).toEqual([
      expect.objectContaining({
        studentId: 77,
        totalPaid: '100.00',
        outstandingBalance: '0.00',
        status: 'PAID',
      }),
    ]);
  });

  it('applies branch, cycle, group and search filters to the overdue export', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new DashboardService({
      branch: {
        findMany: jest.fn().mockResolvedValue([{ id: 1, name: 'Centro' }]),
      },
      academicCycle: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 2,
            name: 'Escolar',
            status: 'ACTIVE',
            startDate: new Date('2027-01-01'),
            endDate: new Date('2027-12-01'),
          },
        ]),
      },
      cycleGroup: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ reusableGroup: { id: 3, name: 'A' } }]),
      },
      enrollment: { findMany },
    } as never);
    await service.overdueExport({
      branchId: 1,
      cycleId: 2,
      groupId: 3,
      search: 'Ana',
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          branchId: 1,
          academicCycleId: { in: [2] },
          group: { reusableGroupId: 3 },
          student: {
            OR: [
              { fullName: { contains: 'Ana', mode: 'insensitive' } },
              { dni: { contains: 'Ana' } },
            ],
          },
        }),
      }),
    );
  });
});
