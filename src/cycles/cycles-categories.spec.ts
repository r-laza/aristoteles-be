import {
  AcademicCycleCategory,
  AcademicCycleStatus,
  PreuniversityDueRule,
  Prisma,
} from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import { CyclesService } from './cycles.service';

describe('Academic cycle categories', () => {
  function creationService() {
    const create = jest.fn(async ({ data }) => ({ id: 10, ...data }));
    const pensionFind = jest.fn().mockResolvedValue({ id: 8 });
    const tx = {
      enrollmentFee: { findUnique: jest.fn().mockResolvedValue({ id: 7 }) },
      branch: { count: jest.fn().mockResolvedValue(1) },
      group: {
        findUnique: jest.fn().mockResolvedValue({ id: 5, branchId: 3 }),
      },
      pension: {
        findUnique: pensionFind,
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 8,
          name: 'Pensión',
          amount: new Prisma.Decimal(600),
          dueDay: 15,
        }),
      },
      academicCycle: {
        create,
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 10 }),
      },
      academicCycleBranch: {
        deleteMany: jest.fn(),
        upsert: jest.fn(),
      },
      cycleGroup: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
        upsert: jest.fn().mockResolvedValue({ id: 20 }),
      },
      enrollment: { updateMany: jest.fn() },
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    return { service: new CyclesService(prisma as never), create, pensionFind };
  }

  const common = {
    name: 'Ciclo 2027',
    startDate: '2027-01-01',
    endDate: '2027-12-31',
    branchIds: [3],
    groups: [{ branchId: 3, groupId: 5, pensionId: 8 }],
  };

  it('creates Escolar with its general module unchanged', async () => {
    const { service, create } = creationService();
    await service.create({
      ...common,
      category: AcademicCycleCategory.SCHOOL,
      feeId: 7,
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        category: AcademicCycleCategory.SCHOOL,
        feeId: 7,
        preuniversityFee: null,
        preuniversityInstallments: null,
        preuniversityDueRule: null,
      }),
    });
  });

  it('creates Preuniversitario without cycle-level payment configuration', async () => {
    const { service, create, pensionFind } = creationService();
    await service.create({
      ...common,
      category: AcademicCycleCategory.PREUNIVERSITY,
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        category: AcademicCycleCategory.PREUNIVERSITY,
        feeId: null,
        preuniversityFee: null,
        preuniversityInstallments: null,
        preuniversityDueRule: null,
      }),
    });
    expect(pensionFind).toHaveBeenCalledWith({ where: { id: 8 } });
  });
});

describe('Preuniversitario student installment plans', () => {
  function enrollmentService(status = AcademicCycleStatus.ACTIVE) {
    const create = jest.fn(async ({ data }) => data);
    const tx = {
      academicCycle: {
        findUnique: jest.fn().mockResolvedValue({
          id: 10,
          category: AcademicCycleCategory.PREUNIVERSITY,
          status,
          fee: null,
          startDate: new Date('2027-01-01T00:00:00.000Z'),
          endDate: new Date('2027-03-31T00:00:00.000Z'),
        }),
      },
      student: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
      cycleGroup: {
        findUnique: jest.fn().mockResolvedValue({
          id: 20,
          academicCycleId: 10,
          branchId: 3,
          reusableGroupId: 5,
          pension: {
            id: 8,
            name: 'Pensión pre',
            amount: new Prisma.Decimal(600),
            dueDay: 15,
          },
        }),
      },
      group: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ branchId: 3 }),
      },
      academicCycleBranch: { findUnique: jest.fn().mockResolvedValue({}) },
      enrollment: {
        findFirst: jest.fn().mockResolvedValue(null),
        create,
      },
    };
    const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
    return { service: new CyclesService(prisma as never), create };
  }

  it.each([
    [1, PreuniversityDueRule.FIFTEENTH, ['600.00'], ['2027-01-15']],
    [
      3,
      PreuniversityDueRule.LAST_DAY,
      ['200.00', '200.00', '200.00'],
      ['2027-01-31', '2027-02-28', '2027-03-31'],
    ],
  ])(
    'enrolls a student with %i installment(s)',
    async (installments, dueRule, amounts, dates) => {
      const { service, create } = enrollmentService();
      await service.enroll(10, {
        studentId: 4,
        groupId: 20,
        branchId: 3,
        pensionDiscountAmount: 0,
        preuniversityInstallments: installments,
        preuniversityDueRule: dueRule,
      });

      const obligations =
        create.mock.calls[0][0].data.pensionObligations.create;
      expect(obligations.map((row) => row.amount.toFixed(2))).toEqual(amounts);
      expect(
        obligations.map((row) => row.dueDate.toISOString().slice(0, 10)),
      ).toEqual(dates);
    },
  );

  it('keeps upcoming-cycle enrollment blocked by the lifecycle rule', async () => {
    const { service, create } = enrollmentService(AcademicCycleStatus.UPCOMING);

    await expect(
      service.enroll(10, {
        studentId: 4,
        groupId: 20,
        branchId: 3,
        pensionDiscountAmount: 0,
        preuniversityInstallments: 1,
        preuniversityDueRule: PreuniversityDueRule.FIFTEENTH,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(create).not.toHaveBeenCalled();
  });
});
