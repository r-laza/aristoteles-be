import { PreuniversityDueRule, Prisma } from '@prisma/client';
import { preuniversitySchedule } from './preuniversity';

describe('preuniversitySchedule', () => {
  it('splits cents without changing the total', () => {
    const rows = preuniversitySchedule(
      new Prisma.Decimal('1000.01'),
      3,
      PreuniversityDueRule.FIFTEENTH,
      new Date('2027-01-01T00:00:00.000Z'),
    );

    expect(rows.map((row) => row.amount.toFixed(2))).toEqual([
      '333.34',
      '333.34',
      '333.33',
    ]);
    expect(rows.reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0)).toFixed(2)).toBe('1000.01');
    expect(rows.map((row) => row.dueDate.toISOString().slice(0, 10))).toEqual([
      '2027-01-15',
      '2027-02-15',
      '2027-03-15',
    ]);
  });

  it('uses the last calendar day, including leap years', () => {
    const rows = preuniversitySchedule(
      new Prisma.Decimal('600'),
      3,
      PreuniversityDueRule.LAST_DAY,
      new Date('2028-01-01T00:00:00.000Z'),
    );

    expect(rows.map((row) => row.dueDate.toISOString().slice(0, 10))).toEqual([
      '2028-01-31',
      '2028-02-29',
      '2028-03-31',
    ]);
  });

  it('rejects installment counts outside one to three', () => {
    expect(() => preuniversitySchedule(new Prisma.Decimal('100'), 4, PreuniversityDueRule.FIFTEENTH, new Date())).toThrow('Invalid installment count');
  });

  it('supports different installment plans for students with the same pension', () => {
    const total = new Prisma.Decimal('600');
    const start = new Date('2027-04-01T00:00:00.000Z');
    const single = preuniversitySchedule(total, 1, PreuniversityDueRule.FIFTEENTH, start);
    const three = preuniversitySchedule(total, 3, PreuniversityDueRule.LAST_DAY, start);

    expect(single.map((row) => row.amount.toFixed(2))).toEqual(['600.00']);
    expect(three.map((row) => row.amount.toFixed(2))).toEqual(['200.00', '200.00', '200.00']);
    expect(single[0].dueDate.toISOString().slice(0, 10)).toBe('2027-04-15');
    expect(three.map((row) => row.dueDate.toISOString().slice(0, 10))).toEqual([
      '2027-04-30',
      '2027-05-31',
      '2027-06-30',
    ]);
  });
});
