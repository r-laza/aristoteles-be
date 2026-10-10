import { PaymentType, Prisma } from '@prisma/client';
import { aggregateAdminDashboard } from './admin-dashboard';
import { DashboardService } from './dashboard.service';

const decimal = (value: string | number) => new Prisma.Decimal(value);

describe('Admin dashboard aggregation', () => {
  it('returns a clean empty result when no cycle is active', async () => {
    const service = new DashboardService({
      academicCycle: { findFirst: jest.fn().mockResolvedValue(null) },
    } as never);
    await expect(service.getAdminDashboard()).resolves.toBeNull();
  });

  it('validates an explicitly selected cycle', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const service = new DashboardService({
      academicCycle: { findFirst },
    } as never);
    await expect(service.getAdminDashboard(99)).rejects.toMatchObject({
      status: 404,
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 99 } }),
    );
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
      studentsWithDebt: 1,
      totalCollected: '150.00',
      outstandingBalance: '180.00',
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
});
