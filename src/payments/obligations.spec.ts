import { Prisma } from '@prisma/client';
import {
  accountStatus,
  cyclePeriods,
  obligations,
  paymentStatus,
  paymentPendingDays,
} from './obligations';

const decimal = (value: string | number) => new Prisma.Decimal(value);
const enrollment = (): Parameters<typeof obligations>[0] => ({
  finalAmount: decimal(100),
  pensionAmount: decimal(50),
  pensionDueDay: 31,
  academicCycle: {
    startDate: new Date('2024-01-15'),
    endDate: new Date('2024-03-15'),
  },
  payments: [{ paymentType: 'ENROLLMENT', period: null, amount: decimal(100) }],
});

describe('Payment obligations', () => {
  it('includes partial boundary months and crosses years', () => {
    expect(
      cyclePeriods(new Date('2025-12-15'), new Date('2026-02-01')),
    ).toEqual(['2025-12', '2026-01', '2026-02']);
  });
  it('keeps paid enrollment separate from unpaid pensions and clamps leap February', () => {
    const charges = obligations(enrollment(), '2024-02-29');
    expect(charges.map((c) => c.status)).toEqual([
      'PAID',
      'OVERDUE',
      'PENDING',
      'PENDING',
    ]);
    expect(charges[2].dueDate).toBe('2024-02-29');
    expect(charges[2].balance.toString()).toBe('50');
    expect(paymentStatus(decimal(150), decimal(100), true)).toBe('OVERDUE');
  });
  it('allocates partial decimal payments only to the selected period', () => {
    const data = enrollment();
    data.payments.push({
      paymentType: 'PENSION',
      period: '2024-02',
      amount: decimal('19.99'),
    });
    const charges = obligations(data, '2024-02-20');
    expect(charges[2].balance.toString()).toBe('30.01');
    expect(charges[2].status).toBe('PARTIAL');
    expect(charges[3].balance.toString()).toBe('50');
    expect(obligations(data, '2024-03-01')[2].status).toBe('OVERDUE');
  });
  it('preserves pension periods after cycle dates change', () => {
    const data = {
      ...enrollment(),
      pensionStartDate: new Date('2023-12-01'),
      pensionEndDate: new Date('2024-01-31'),
    };
    expect(obligations(data).map((c) => c.period)).toEqual([
      null,
      '2023-12',
      '2024-01',
    ]);
  });
  it('supports legacy groups without pensions and zero-fee enrollments', () => {
    const charges = obligations({
      ...enrollment(),
      finalAmount: decimal(0),
      payments: [],
      pensionAmount: null,
      pensionDueDay: null,
    });
    expect(charges).toHaveLength(1);
    expect(charges[0].status).toBe('PAID');
  });
  it('exposes separate enrollment and pension discount snapshots', () => {
    const charges = obligations({
      ...enrollment(),
      baseAmount: decimal(120),
      discountAmount: decimal(20),
      pensionBaseAmount: decimal(60),
      pensionDiscountAmount: decimal(10),
    });
    expect(charges[0]).toEqual(
      expect.objectContaining({
        originalAmount: decimal(120),
        discountAmount: decimal(20),
        amountDue: decimal(100),
      }),
    );
    expect(charges[1]).toEqual(
      expect.objectContaining({
        originalAmount: decimal(60),
        discountAmount: decimal(10),
        amountDue: decimal(50),
      }),
    );
  });
  it('uses the same account status rule as payment management', () => {
    const data = enrollment();
    data.payments.push({
      paymentType: 'PENSION',
      period: '2024-01',
      amount: decimal(50),
    });
    expect(accountStatus(obligations(data, '2024-01-20'), '2024-01-20')).toBe(
      'PAID',
    );
    expect(accountStatus(obligations(data, '2024-03-01'), '2024-03-01')).toBe(
      'OVERDUE',
    );
  });
  it('validates the configurable pending warning period', () => {
    expect(paymentPendingDays(undefined)).toBe(7);
    expect(paymentPendingDays('0')).toBe(0);
    expect(paymentPendingDays('12')).toBe(12);
    for (const invalid of ['-1', '1.5', 'abc', ' 7'])
      expect(() => paymentPendingDays(invalid)).toThrow(
        'PAYMENT_PENDING_DAYS must be a non-negative integer',
      );
  });
  it('applies inclusive warning boundaries only to unpaid installments', () => {
    const charge = (dueDate: string, balance = 50, amountPaid = 0) => ({
      paymentType: 'PENSION' as const,
      period: dueDate.slice(0, 7),
      dueDate,
      amountDue: decimal(50),
      originalAmount: decimal(50),
      discountAmount: decimal(0),
      amountPaid: decimal(amountPaid),
      balance: decimal(balance),
      status: balance === 0 ? 'PAID' : 'PENDING',
    });
    expect(accountStatus([charge('2027-01-17')], '2027-01-10', 7)).toBe(
      'PENDING',
    );
    expect(accountStatus([charge('2027-01-18')], '2027-01-10', 7)).toBe('PAID');
    expect(accountStatus([charge('2027-01-10')], '2027-01-10', 7)).toBe(
      'PENDING',
    );
    expect(accountStatus([charge('2027-01-09')], '2027-01-10', 7)).toBe(
      'OVERDUE',
    );
    expect(accountStatus([charge('2027-01-09', 0, 50)], '2027-01-10', 7)).toBe(
      'PAID',
    );
    expect(accountStatus([charge('2027-01-11')], '2027-01-10', 0)).toBe('PAID');
  });
});
