import { CyclesService } from './cycles.service';
import { BadRequestException, ConflictException } from '@nestjs/common';

describe('Cycle groups scoped by branch', () => {
  it('rejects duplicate groups before starting a bulk branch update', async () => {
    const transaction = jest.fn();
    const service = new CyclesService({ $transaction: transaction } as never);

    await expect(
      service.configureCycleBranch(10, {
        branchId: 4,
        groups: [
          { groupId: 8, pensionId: 2 },
          { groupId: 8, pensionId: 3 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('adds a branch and saves all selected groups in one transaction', async () => {
    const upsertGroup = jest.fn(({ create }) =>
      Promise.resolve({ id: create.reusableGroupId + 100 }),
    );
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: 10,
          category: 'PREUNIVERSITY',
          startDate: new Date('2027-01-01'),
          endDate: new Date('2027-12-31'),
        },
      ]),
      branch: {
        findUnique: jest.fn().mockResolvedValue({ id: 4, isActive: true }),
      },
      group: { count: jest.fn().mockResolvedValue(3) },
      pension: { count: jest.fn().mockResolvedValue(3) },
      academicCycleBranch: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
      },
      cycleGroup: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
        upsert: upsertGroup,
      },
      enrollment: { updateMany: jest.fn() },
    };
    const transaction = jest.fn((callback) => callback(tx));
    const service = new CyclesService({ $transaction: transaction } as never);

    await service.configureCycleBranch(10, {
      branchId: 4,
      groups: [
        { groupId: 8, pensionId: 2 },
        { groupId: 9, pensionId: 3 },
        { groupId: 10, pensionId: 4 },
      ],
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tx.academicCycleBranch.upsert).toHaveBeenCalledTimes(1);
    expect(upsertGroup).toHaveBeenCalledTimes(3);
  });

  it('rolls back branch configuration when a removed group has history', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: 10,
          category: 'SCHOOL',
          startDate: new Date('2027-01-01'),
          endDate: new Date('2027-12-31'),
        },
      ]),
      branch: {
        findUnique: jest.fn().mockResolvedValue({ id: 4, isActive: true }),
      },
      group: { count: jest.fn().mockResolvedValue(0) },
      pension: { count: jest.fn().mockResolvedValue(0) },
      academicCycleBranch: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
      },
      cycleGroup: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 30,
            reusableGroupId: 8,
            _count: { enrollments: 0, transfersFrom: 1, transfersTo: 0 },
          },
        ]),
        deleteMany: jest.fn(),
        upsert: jest.fn(),
      },
    };
    const service = new CyclesService({
      $transaction: jest.fn((callback) => callback(tx)),
    } as never);

    await expect(
      service.configureCycleBranch(10, { branchId: 4, groups: [] }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.cycleGroup.deleteMany).not.toHaveBeenCalled();
  });

  it('does not remove a branch with enrolled students', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ branchId: 4 }]),
      enrollment: { count: jest.fn().mockResolvedValue(1) },
      cycleGroup: { findMany: jest.fn(), deleteMany: jest.fn() },
      academicCycleBranch: { delete: jest.fn() },
    };
    const service = new CyclesService({
      $transaction: jest.fn((callback) => callback(tx)),
    } as never);

    await expect(service.deleteCycleBranch(10, 4)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.cycleGroup.deleteMany).not.toHaveBeenCalled();
    expect(tx.academicCycleBranch.delete).not.toHaveBeenCalled();
  });
  it('returns every branch relation assigned to the cycle', async () => {
    const cycle = {
      id: 10,
      branches: [
        { branch: { id: 1, name: 'Sede Principal' } },
        { branch: { id: 3, name: 'Huánuco' } },
      ],
    };
    const findUnique = jest.fn().mockResolvedValue(cycle);
    const service = new CyclesService({
      academicCycle: { findUnique },
    } as never);

    await expect(service.detail(10)).resolves.toBe(cycle);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 10 },
      include: expect.objectContaining({
        branches: { include: { branch: true } },
      }),
    });
  });

  it('loads assigned groups only for the selected cycle branch', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      academicCycle: {
        findUnique: jest.fn().mockResolvedValue({ id: 149, fee: null }),
      },
      academicCycleBranch: { findUnique: jest.fn().mockResolvedValue({}) },
      cycleGroup: { findMany },
    };
    const service = new CyclesService(prisma as never);

    await service.groups(149, 2);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { academicCycleId: 149, branchId: 2 },
      }),
    );
  });

  it('lists catalog groups not yet assigned to the selected cycle branch', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      academicCycleBranch: { findUnique: jest.fn().mockResolvedValue({}) },
      group: { findMany },
    };
    const service = new CyclesService(prisma as never);

    await service.availableGroups(10, 3);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          cycles: { none: { academicCycleId: 10, branchId: 3 } },
        },
      }),
    );
  });

  it('creates independent assignments of the same catalog group in different branches', async () => {
    const create = jest.fn().mockResolvedValue({ id: 30 });
    const tx = {
      academicCycle: { findUnique: jest.fn().mockResolvedValue({ id: 10 }) },
      group: {
        findUnique: jest.fn().mockResolvedValue({ id: 8, name: 'Espartanos' }),
      },
      academicCycleBranch: { findUnique: jest.fn().mockResolvedValue({}) },
      pension: {
        findUnique: jest.fn(({ where }) => Promise.resolve({ id: where.id })),
      },
      cycleGroup: { create },
    };
    const service = new CyclesService({
      $transaction: jest.fn((callback) => callback(tx)),
    } as never);

    await service.addCycleGroup(10, { branchId: 4, groupId: 8, pensionId: 9 });
    await service.addCycleGroup(10, { branchId: 5, groupId: 8, pensionId: 10 });
    expect(create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: {
          academicCycleId: 10,
          branchId: 4,
          reusableGroupId: 8,
          pensionId: 9,
        },
      }),
    );
    expect(create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: {
          academicCycleId: 10,
          branchId: 5,
          reusableGroupId: 8,
          pensionId: 10,
        },
      }),
    );
  });

  it('saves the same catalog group in two cycle branches with independent pensions', async () => {
    const upsert = jest.fn().mockResolvedValue({ id: 30 });
    const tx = {
      branch: { count: jest.fn().mockResolvedValue(2) },
      group: {
        findUnique: jest.fn().mockResolvedValue({ id: 8, name: 'Espartanos' }),
      },
      pension: {
        findUnique: jest.fn(({ where }) => Promise.resolve({ id: where.id })),
        findUniqueOrThrow: jest.fn(({ where }) =>
          Promise.resolve({
            id: where.id,
            name: `Pension ${where.id}`,
            amount: 100,
            dueDay: 15,
          }),
        ),
      },
      academicCycle: {
        create: jest.fn().mockResolvedValue({
          id: 10,
          startDate: new Date('2027-01-01T00:00:00.000Z'),
          endDate: new Date('2027-12-31T00:00:00.000Z'),
        }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 10 }),
      },
      academicCycleBranch: { deleteMany: jest.fn(), upsert: jest.fn() },
      cycleGroup: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
        upsert,
      },
      enrollment: { updateMany: jest.fn() },
    };
    const service = new CyclesService({
      $transaction: jest.fn((callback) => callback(tx)),
    } as never);

    await service.create({
      name: 'Pre 2027',
      category: 'PREUNIVERSITY',
      startDate: '2027-01-01',
      endDate: '2027-12-31',
      branchIds: [4, 5],
      groups: [
        { branchId: 4, groupId: 8, pensionId: 9 },
        { branchId: 5, groupId: 8, pensionId: 10 },
      ],
    });

    expect(upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          academicCycleId_branchId_reusableGroupId: {
            academicCycleId: 10,
            branchId: 4,
            reusableGroupId: 8,
          },
        },
        create: expect.objectContaining({
          branchId: 4,
          reusableGroupId: 8,
          pensionId: 9,
        }),
      }),
    );
    expect(upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          academicCycleId_branchId_reusableGroupId: {
            academicCycleId: 10,
            branchId: 5,
            reusableGroupId: 8,
          },
        },
        create: expect.objectContaining({
          branchId: 5,
          reusableGroupId: 8,
          pensionId: 10,
        }),
      }),
    );
  });

  it('rejects a duplicate group assignment within one branch and cycle', async () => {
    const transaction = jest.fn();
    const service = new CyclesService({ $transaction: transaction } as never);

    await expect(
      service.create({
        name: 'Escolar 2027',
        category: 'SCHOOL',
        feeId: 7,
        startDate: '2027-01-01',
        endDate: '2027-12-31',
        branchIds: [4],
        groups: [
          { branchId: 4, groupId: 8, pensionId: 9 },
          { branchId: 4, groupId: 8, pensionId: 10 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });
});
