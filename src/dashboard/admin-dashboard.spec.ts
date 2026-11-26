import { PaymentType, Prisma } from '@prisma/client';
import { aggregateAdminDashboard, overdueSummary, paginate } from './admin-dashboard';
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
      branch: { findMany: jest.fn().mockResolvedValue([{ id: 1, name: 'Centro' }]) },
      academicCycle: { findMany },
    } as never);
    await expect(service.getAdminDashboard({ cycleId: 99 })).rejects.toMatchObject({
      status: 404,
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { branches: { some: { branchId: 1 } } } }),
    );
  });

  it('returns every cycle status and defaults to an active cycle', async () => {
    const cycles = [
      { id: 3, name: 'Cerrado', status: 'CLOSED', startDate: new Date('2026-01-01'), endDate: new Date('2026-03-01') },
      { id: 2, name: 'Activo', status: 'ACTIVE', startDate: new Date('2026-04-01'), endDate: new Date('2026-12-01') },
      { id: 1, name: 'Próximo', status: 'UPCOMING', startDate: new Date('2027-01-01'), endDate: new Date('2027-03-01') },
    ];
    const service = new DashboardService({
      branch: { findMany: jest.fn().mockResolvedValue([{ id: 8, name: 'Centro' }]) },
      academicCycle: { findMany: jest.fn().mockResolvedValue(cycles) },
      cycleGroup: { findMany: jest.fn().mockResolvedValue([]) },
      enrollment: { findMany: jest.fn().mockResolvedValue([]) },
    } as never);
    const result = await service.getAdminDashboard();
    expect(result.selectedBranchId).toBe(8);
    expect(result.selectedCycleId).toBe(2);
    expect(result.cycles.map((cycle) => cycle.status)).toEqual(['CLOSED', 'ACTIVE', 'UPCOMING']);
    expect(result.dashboard?.activeCycle.name).toBe('Activo');
  });

  it('allows a closed cycle to be selected for historical reporting', async () => {
    const closed = { id: 3, name: 'Histórico', status: 'CLOSED', startDate: new Date('2025-01-01'), endDate: new Date('2025-03-01') };
    const service = new DashboardService({
      branch: { findMany: jest.fn().mockResolvedValue([{ id: 1, name: 'Centro' }]) },
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
        startDate: new Date('2027-01-15T00:00:00.000Z'),
        endDate: new Date('2027-03-31T00:00:00.000Z'),
        enrollments: [
          {
            finalAmount: decimal(100),
            pensionAmount: decimal(50),
            pensionDueDay: 10,
            academicCycle: {
              startDate: new Date('2027-01-15T00:00:00.000Z'),
              endDate: new Date('2027-03-31T00:00:00.000Z'),
            },
            payments: [
              {
                amount: decimal(100),
                paymentType: PaymentType.ENROLLMENT,
                period: null,
                paymentDate: new Date('2027-01-20T00:00:00.000Z'),
              },
              {
                amount: decimal(50),
                paymentType: PaymentType.PENSION,
                period: '2027-01',
                paymentDate: new Date('2027-02-01T00:00:00.000Z'),
              },
            ],
          },
          {
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
  });

  it('distinguishes overdue installments from future unpaid installments', () => {
    const result = overdueSummary({
      finalAmount: decimal(0), pensionAmount: decimal(100), pensionDueDay: 10,
      academicCycle: { startDate: new Date('2027-01-01T00:00:00.000Z'), endDate: new Date('2027-03-31T00:00:00.000Z') },
      payments: [],
    }, '2027-02-05');
    expect(result.charges.map((charge) => charge.period)).toEqual(['2027-01']);
    expect(result.balance.toFixed(2)).toBe('100.00');
  });

  it('paginates debtor results in pages of twenty', () => {
    expect(paginate(Array.from({ length: 45 }, (_, index) => index + 1), 2)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 21),
    );
  });

  it('groups multiple payments into exactly one student row', async () => {
    const cycle = { id: 2, name: 'Escolar', status: 'ACTIVE', startDate: new Date('2026-01-01'), endDate: new Date('2026-03-31') };
    const service = new DashboardService({
      branch: { findMany: jest.fn().mockResolvedValue([{ id: 1, name: 'Centro' }]) },
      academicCycle: { findMany: jest.fn().mockResolvedValue([cycle]) },
      cycleGroup: { findMany: jest.fn().mockResolvedValue([]) },
      enrollment: { findMany: jest.fn().mockResolvedValue([{
        id: 10, finalAmount: decimal(100), baseAmount: decimal(100), discountAmount: decimal(0),
        pensionStartDate: null, pensionEndDate: null, pensionBaseAmount: null, pensionDiscountAmount: null,
        pensionAmount: null, pensionDueDay: null, pensionObligations: [], academicCycle: cycle,
        student: { id: 77, fullName: 'Alex Pérez', dni: '12345678' },
        group: { reusableGroup: { name: 'A' } },
        payments: [
          { id: 1, amount: decimal(30), paymentType: PaymentType.ENROLLMENT, period: null, paymentDate: new Date('2026-01-01'), paymentMethod: 'CASH' },
          { id: 2, amount: decimal(70), paymentType: PaymentType.ENROLLMENT, period: null, paymentDate: new Date('2026-01-02'), paymentMethod: 'CASH' },
        ],
      }]) },
    } as never);
    const result = await service.payments({ page: 1, search: '' });
    expect(result.total).toBe(1);
    expect(result.items).toEqual([
      expect.objectContaining({ studentId: 77, totalPaid: '100.00', outstandingBalance: '0.00', status: 'PAID' }),
    ]);
  });

  it('applies branch, cycle, group and search filters to the overdue export', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new DashboardService({
      branch: { findMany: jest.fn().mockResolvedValue([{ id: 1, name: 'Centro' }]) },
      academicCycle: { findMany: jest.fn().mockResolvedValue([{ id: 2, name: 'Escolar', status: 'ACTIVE', startDate: new Date('2027-01-01'), endDate: new Date('2027-12-01') }]) },
      cycleGroup: { findMany: jest.fn().mockResolvedValue([{ reusableGroup: { id: 3, name: 'A' } }]) },
      enrollment: { findMany },
    } as never);
    await service.overdueExport({ branchId: 1, cycleId: 2, groupId: 3, search: 'Ana' });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        branchId: 1,
        academicCycleId: { in: [2] },
        group: { reusableGroupId: 3 },
        student: { OR: [
          { fullName: { contains: 'Ana', mode: 'insensitive' } },
          { dni: { contains: 'Ana' } },
        ] },
      }),
    }));
  });
});
