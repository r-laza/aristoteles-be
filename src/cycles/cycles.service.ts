import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { cyclePeriods, institutionToday } from '../payments/obligations';

function bodyObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new BadRequestException();
  return body as Record<string, unknown>;
}
function name(value: unknown, max = 100): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw new BadRequestException();
  return value.trim();
}
function money(value: unknown): Prisma.Decimal {
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    !/^\d{1,10}(\.\d{1,2})?$/.test(String(value))
  )
    throw new BadRequestException('Invalid amount');
  return new Prisma.Decimal(value);
}
function date(value: unknown): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new BadRequestException('Invalid date');
  const result = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(result.getTime()) ||
    result.toISOString().slice(0, 10) !== value
  )
    throw new BadRequestException('Invalid date');
  return result;
}
function id(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
    throw new BadRequestException('Invalid id');
  return value;
}
const cycleInclude = {
  fee: true,
  branches: { include: { branch: true } },
  _count: { select: { enrollments: true, groups: true } },
} as const;
const enrollmentInclude = {
  student: { select: { id: true, fullName: true, dni: true } },
  group: { include: { reusableGroup: true } },
  branch: true,
  transfers: { include: { previousBranch: true, newBranch: true, previousGroup: { include: { reusableGroup: true } }, newGroup: { include: { reusableGroup: true } } }, orderBy: { transferDate: 'asc' as const } },
  fee: true,
} as const;

@Injectable()
export class CyclesService {
  constructor(private readonly prisma: PrismaService) {}
  branches(activeOnly = false) {
    return this.prisma.branch.findMany({ where: activeOnly ? { isActive: true } : {}, include: { _count: { select: { groups: true, cycles: true } } }, orderBy: { name: 'asc' } });
  }
  async saveBranch(body: unknown, branchId?: number) {
    const input = bodyObject(body);
    const data = {
      name: name(input.name),
      address: input.address ? name(input.address, 250) : null,
      details: input.details ? name(input.details, 500) : null,
      isActive: typeof input.isActive === 'boolean' ? input.isActive : true,
    };
    try {
      if (branchId === undefined) return await this.prisma.branch.create({ data });
      if (!(await this.prisma.branch.findUnique({ where: { id: branchId } }))) throw new NotFoundException();
      return await this.prisma.branch.update({ where: { id: branchId }, data });
    } catch (error) { this.rethrowConflict(error); }
  }
  list() {
    return this.prisma.academicCycle.findMany({
      include: cycleInclude,
      orderBy: { startDate: 'asc' },
    });
  }
  async detail(cycleId: number) {
    const cycle = await this.prisma.academicCycle.findUnique({
      where: { id: cycleId },
      include: cycleInclude,
    });
    if (!cycle) throw new NotFoundException();
    return cycle;
  }
  async updateDetails(cycleId: number, body: unknown) {
    const input = bodyObject(body);
    const startDate = date(input.startDate);
    const endDate = date(input.endDate);
    if (endDate < startDate)
      throw new BadRequestException('Invalid date range');
    const feeId = id(input.feeId);
    if (
      !(await this.prisma.academicCycle.findUnique({ where: { id: cycleId } }))
    )
      throw new NotFoundException();
    if (!(await this.prisma.enrollmentFee.findUnique({ where: { id: feeId } })))
      throw new BadRequestException('Unknown enrollment fee');
    return this.prisma.academicCycle.update({
      where: { id: cycleId },
      data: { name: name(input.name), startDate, endDate, feeId },
      include: cycleInclude,
    });
  }
  async deleteCycle(cycleId: number) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ id: number }[]>`
          SELECT "id" FROM "AcademicCycle" WHERE "id" = ${cycleId} FOR UPDATE
        `;
        if (!rows.length) throw new NotFoundException();
        // Payments belong to enrollments; preserving every enrollment also
        // protects all payments and historical amounts for this cycle.
        if (await tx.enrollment.count({ where: { academicCycleId: cycleId } }))
          throw new ConflictException('Cycle has enrolled students');
        await tx.cycleGroup.deleteMany({ where: { academicCycleId: cycleId } });
        await tx.academicCycle.delete({ where: { id: cycleId } });
        return { id: cycleId };
      });
    } catch (error) {
      this.rethrowConflict(error);
    }
  }
  async create(body: unknown, cycleId?: number) {
    const input = bodyObject(body);
    const startDate = date(input.startDate),
      endDate = date(input.endDate);
    const cycleName = name(input.name);
    if (endDate < startDate)
      throw new BadRequestException('Invalid date range');
    if (!Array.isArray(input.groups) || !input.groups.length)
      throw new BadRequestException('Groups required');
    const feeId = id(input.feeId);
    if (!Array.isArray(input.branchIds) || !input.branchIds.length)
      throw new BadRequestException('Branches required');
    const branchIds = input.branchIds.map(id);
    if (new Set(branchIds).size !== branchIds.length) throw new BadRequestException();
    const assignments = input.groups.map((value: unknown) => {
      const row = bodyObject(value);
      return { groupId: id(row.groupId), pensionId: id(row.pensionId) };
    });
    if (
      new Set(assignments.map((row) => row.groupId)).size !== assignments.length
    )
      throw new BadRequestException();
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          if (!(await tx.enrollmentFee.findUnique({ where: { id: feeId } })))
            throw new BadRequestException('Unknown enrollment fee');
          if (await tx.branch.count({ where: { id: { in: branchIds }, isActive: true } }) !== branchIds.length)
            throw new BadRequestException('Unknown branch');
          for (const row of assignments) {
            const reusableGroup = await tx.group.findUnique({ where: { id: row.groupId } });
            if (
              !reusableGroup || !branchIds.includes(reusableGroup.branchId) ||
              !(await tx.pension.findUnique({ where: { id: row.pensionId } }))
            )
              throw new BadRequestException('Unknown group or fee');
          }
          if (
            cycleId !== undefined &&
            !(await tx.academicCycle.findUnique({ where: { id: cycleId } }))
          )
            throw new NotFoundException();
          const data = { name: cycleName, startDate, endDate, feeId };
          const cycle =
            cycleId === undefined
              ? await tx.academicCycle.create({ data })
              : await tx.academicCycle.update({ where: { id: cycleId }, data });
          if (cycleId !== undefined && await tx.enrollment.count({ where: { academicCycleId: cycle.id, branchId: { notIn: branchIds } } }))
            throw new ConflictException('Branch has enrolled students');
          await tx.academicCycleBranch.deleteMany({ where: { academicCycleId: cycle.id, branchId: { notIn: branchIds } } });
          await Promise.all(branchIds.map((branchId) => tx.academicCycleBranch.upsert({
            where: { academicCycleId_branchId: { academicCycleId: cycle.id, branchId } },
            create: { academicCycleId: cycle.id, branchId }, update: {},
          })));
          const removed = await tx.cycleGroup.findMany({
            where: {
              academicCycleId: cycle.id,
              reusableGroupId: { notIn: assignments.map((row) => row.groupId) },
            },
            include: { _count: { select: { enrollments: true } } },
          });
          if (removed.some((group) => group._count.enrollments > 0))
            throw new ConflictException('Group has enrolled students');
          await tx.cycleGroup.deleteMany({
            where: { id: { in: removed.map((group) => group.id) } },
          });
          for (const row of assignments) {
            const assignedGroup = await tx.cycleGroup.upsert({
              where: {
                academicCycleId_reusableGroupId: {
                  academicCycleId: cycle.id,
                  reusableGroupId: row.groupId,
                },
              },
              create: {
                academicCycleId: cycle.id,
                reusableGroupId: row.groupId,
                pensionId: row.pensionId,
              },
              update: { pensionId: row.pensionId, fees: { set: [] } },
            });
            const pension = await tx.pension.findUniqueOrThrow({
              where: { id: row.pensionId },
            });
            await tx.enrollment.updateMany({
              where: { groupId: assignedGroup.id, pensionAmount: null },
              data: {
                pensionName: pension.name,
                pensionBaseAmount: pension.amount,
                pensionDiscountAmount: 0,
                pensionAmount: pension.amount,
                pensionDueDay: pension.dueDay,
                pensionStartDate: cycle.startDate,
                pensionEndDate: cycle.endDate,
              },
            });
          }
          return tx.academicCycle.findUniqueOrThrow({
            where: { id: cycle.id },
            include: cycleInclude,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      this.rethrowConflict(error);
    }
  }
  reusablePensions() {
    return this.prisma.pension.findMany({
      include: { _count: { select: { cycleGroups: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }
  async savePension(body: unknown, pensionId?: number) {
    const input = bodyObject(body);
    if (
      typeof input.dueDay !== 'number' ||
      !Number.isInteger(input.dueDay) ||
      input.dueDay < 1 ||
      input.dueDay > 31 ||
      typeof input.isActive !== 'boolean'
    )
      throw new BadRequestException('Invalid pension');
    const data = {
      name: name(input.name),
      amount: money(input.amount),
      dueDay: input.dueDay,
      isActive: input.isActive,
    };
    if (pensionId === undefined) return this.prisma.pension.create({ data });
    if (!(await this.prisma.pension.findUnique({ where: { id: pensionId } })))
      throw new NotFoundException();
    return this.prisma.pension.update({ where: { id: pensionId }, data });
  }
  async deletePension(pensionId: number) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<
          { id: number }[]
        >`SELECT "id" FROM "Pension" WHERE "id" = ${pensionId} FOR UPDATE`;
        if (!rows.length) throw new NotFoundException();
        if (await tx.cycleGroup.count({ where: { pensionId } }))
          throw new ConflictException('Pension is in use');
        await tx.pension.delete({ where: { id: pensionId } });
        return { id: pensionId };
      });
    } catch (error) {
      this.rethrowConflict(error);
    }
  }
  reusableFees() {
    return this.prisma.enrollmentFee.findMany({
      include: {
        _count: {
          select: { cycles: true, cycleGroups: true, enrollments: true },
        },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }
  async deleteFee(feeId: number) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Lock the referenced row so a concurrent assignment cannot be silently
        // removed by the join table's cascading foreign key during deletion.
        const rows = await tx.$queryRaw<{ id: number }[]>`
          SELECT "id" FROM "EnrollmentFee" WHERE "id" = ${feeId} FOR UPDATE
        `;
        if (!rows.length) throw new NotFoundException();
        const fee = await tx.enrollmentFee.findUniqueOrThrow({
          where: { id: feeId },
          include: {
            _count: {
              select: { cycles: true, cycleGroups: true, enrollments: true },
            },
          },
        });
        if (
          fee._count.cycles ||
          fee._count.cycleGroups ||
          fee._count.enrollments
        )
          throw new ConflictException('Fee is in use');
        await tx.enrollmentFee.delete({ where: { id: feeId } });
        return { id: feeId };
      });
    } catch (error) {
      this.rethrowConflict(error);
    }
  }
  async saveFee(body: unknown, feeId?: number) {
    const input = bodyObject(body);
    const validFrom = date(input.validFrom);
    const validUntil =
      input.validUntil === undefined ||
      input.validUntil === '' ||
      input.validUntil === null
        ? null
        : date(input.validUntil);
    if (validUntil && validUntil < validFrom) throw new BadRequestException();
    const data = {
      name: name(input.name),
      amount: money(input.amount),
      validFrom,
      validUntil,
    };
    if (feeId === undefined) return this.prisma.enrollmentFee.create({ data });
    if (!(await this.prisma.enrollmentFee.findUnique({ where: { id: feeId } })))
      throw new NotFoundException();
    return this.prisma.enrollmentFee.update({ where: { id: feeId }, data });
  }
  async groups(cycleId: number) {
    const cycle = await this.detail(cycleId);
    const groups = await this.prisma.cycleGroup.findMany({
      where: { academicCycleId: cycleId },
      include: {
        reusableGroup: { include: { branch: true } },
        pension: true,
        _count: { select: { enrollments: true } },
      },
      orderBy: { reusableGroup: { name: 'asc' } },
    });
    return groups.map((group) => ({
      ...group,
      name: group.reusableGroup.name,
      fees: cycle.fee ? [cycle.fee] : [],
    }));
  }
  async addCycleGroup(cycleId: number, body: unknown) {
    const input = bodyObject(body);
    const groupId = id(input.groupId);
    const pensionId = id(input.pensionId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (!(await tx.academicCycle.findUnique({ where: { id: cycleId } })))
          throw new NotFoundException();
        const reusableGroup = await tx.group.findUnique({ where: { id: groupId } });
        if (!reusableGroup)
          throw new BadRequestException('Unknown group');
        if (!(await tx.academicCycleBranch.findUnique({ where: { academicCycleId_branchId: { academicCycleId: cycleId, branchId: reusableGroup.branchId } } })))
          throw new BadRequestException('Branch unavailable for cycle');
        if (!(await tx.pension.findUnique({ where: { id: pensionId } })))
          throw new BadRequestException('Unknown pension');
        return tx.cycleGroup.create({
          data: {
            academicCycleId: cycleId,
            reusableGroupId: groupId,
            pensionId,
          },
          include: { reusableGroup: true, pension: true },
        });
      });
    } catch (error) {
      this.rethrowConflict(error);
    }
  }
  async deleteCycleGroup(cycleId: number, groupId: number) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<
          { id: number; reusableGroupId: number }[]
        >`
          SELECT "id", "reusableGroupId" FROM "Group"
          WHERE "id" = ${groupId} AND "academicCycleId" = ${cycleId}
          FOR UPDATE
        `;
        const group = rows[0];
        if (!group) throw new NotFoundException();
        if (await tx.enrollment.count({ where: { groupId } }))
          throw new ConflictException('Group has dependent records');
        await tx.cycleGroup.delete({ where: { id: groupId } });
        if (
          !(await tx.cycleGroup.count({
            where: { reusableGroupId: group.reusableGroupId },
          }))
        )
          await tx.group.delete({ where: { id: group.reusableGroupId } });
        return { id: groupId };
      });
    } catch (error) {
      this.rethrowConflict(error);
    }
  }
  reusableGroups() {
    return this.prisma.group.findMany({
      orderBy: { name: 'asc' },
      include: { branch: true, _count: { select: { cycles: true } } },
    });
  }
  async deleteGroup(groupId: number) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ id: number }[]>`
          SELECT "id" FROM "ReusableGroup" WHERE "id" = ${groupId} FOR UPDATE
        `;
        if (!rows.length) throw new NotFoundException();
        if (await tx.cycleGroup.count({ where: { reusableGroupId: groupId } }))
          throw new ConflictException('Group is in use');
        await tx.group.delete({ where: { id: groupId } });
        return { id: groupId };
      });
    } catch (error) {
      this.rethrowConflict(error);
    }
  }
  async saveGroup(body: unknown, groupId?: number) {
    const input = bodyObject(body);
    const data = { name: name(input.name), branchId: id(input.branchId) };
    try {
      if (!(await this.prisma.branch.findUnique({ where: { id: data.branchId } }))) throw new BadRequestException('Unknown branch');
      if (groupId !== undefined) {
        if (!(await this.prisma.group.findUnique({ where: { id: groupId } })))
          throw new NotFoundException();
        return await this.prisma.group.update({ where: { id: groupId }, data });
      }
      return await this.prisma.group.create({ data });
    } catch (error) {
      this.rethrowConflict(error);
    }
  }
  async available(cycleId: number) {
    await this.detail(cycleId);
    return this.prisma.student.findMany({
      where: {
        isActive: true,
        academicEnrollments: { none: { academicCycleId: cycleId } },
      },
      select: { id: true, fullName: true, dni: true },
      orderBy: { fullName: 'asc' },
    });
  }
  async enrollments(cycleId: number) {
    await this.detail(cycleId);
    const enrollments = await this.prisma.enrollment.findMany({
      where: { academicCycleId: cycleId },
      include: enrollmentInclude,
      orderBy: { createdAt: 'desc' },
    });
    return enrollments.map((enrollment) => ({
      ...enrollment,
      group: {
        id: enrollment.group.id,
        name: enrollment.group.reusableGroup.name,
      },
    }));
  }
  async enroll(cycleId: number, body: unknown) {
    const input = bodyObject(body);
    if ('discountAmount' in input || 'feeId' in input)
      throw new BadRequestException('Enrollment prices are cycle-defined');
    const studentId = id(input.studentId),
      groupId = id(input.groupId), branchId = id(input.branchId);
    const discountPercent = money(input.discountPercent ?? 0);
    const pensionDiscountPercent = money(input.pensionDiscountPercent ?? 0);
    const discountReason =
      input.discountReason === undefined || input.discountReason === ''
        ? null
        : name(input.discountReason, 500);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const cycle = await tx.academicCycle.findUnique({
          where: { id: cycleId },
          include: { fee: true },
        });
        if (!cycle) throw new NotFoundException();
        const student = await tx.student.findUnique({
          where: { id: studentId },
          select: { isActive: true },
        });
        if (!student || !student.isActive)
          throw new BadRequestException('Student required');
        const group = await tx.cycleGroup.findUnique({
          where: { id: groupId },
          include: { pension: true },
        });
        if (!group || group.academicCycleId !== cycleId)
          throw new BadRequestException('Group must belong to cycle');
        const reusableGroup = await tx.group.findUniqueOrThrow({ where: { id: group.reusableGroupId } });
        if (reusableGroup.branchId !== branchId || !(await tx.academicCycleBranch.findUnique({ where: { academicCycleId_branchId: { academicCycleId: cycleId, branchId } } })))
          throw new BadRequestException('Branch unavailable for cycle');
        const fee = cycle.fee;
        // Validity is a calendar date in the institution's timezone.
        const today = date(
          new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Guayaquil',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date()),
        );
        if (
          !fee ||
          fee.validFrom > today ||
          (fee.validUntil && fee.validUntil < today)
        )
          throw new BadRequestException('Fee unavailable for this group');
        const baseAmount = fee.amount;
        if (
          discountPercent.greaterThan(100) ||
          pensionDiscountPercent.greaterThan(100)
        )
          throw new BadRequestException('Invalid discount percentage');
        if (!group.pension)
          throw new BadRequestException('Group pension required');
        const discountAmount = baseAmount
          .mul(discountPercent)
          .div(100)
          .toDecimalPlaces(2);
        const pensionBaseAmount = group.pension.amount;
        const pensionDiscountAmount = pensionBaseAmount
          .mul(pensionDiscountPercent)
          .div(100)
          .toDecimalPlaces(2);
        return tx.enrollment.create({
          data: {
            studentId,
            academicCycleId: cycleId,
            branchId,
            groupId,
            feeId: fee.id,
            baseAmount,
            discountPercent,
            discountAmount,
            discountReason,
            finalAmount: baseAmount.minus(discountAmount),
            enrollmentFeeName: fee.name,
            pensionName: group.pension?.name,
            pensionStartDate: cycle.startDate,
            pensionEndDate: cycle.endDate,
            pensionBaseAmount,
            pensionDiscountPercent,
            pensionDiscountAmount,
            pensionAmount: pensionBaseAmount.minus(pensionDiscountAmount),
            pensionDueDay: group.pension.dueDay,
            pensionObligations: { create: cyclePeriods(cycle.startDate, cycle.endDate).map((period) => {
              const [year, month] = period.split('-').map(Number);
              const day = Math.min(group.pension!.dueDay, new Date(Date.UTC(year, month, 0)).getUTCDate());
              return { period, name: group.pension!.name, baseAmount: pensionBaseAmount, discountAmount: pensionDiscountAmount, amount: pensionBaseAmount.minus(pensionDiscountAmount), dueDate: new Date(`${period}-${String(day).padStart(2, '0')}T00:00:00.000Z`) };
            }) },
          },
          include: enrollmentInclude,
        });
      });
    } catch (error) {
      this.rethrowConflict(error);
    }
  }
  async transfer(enrollmentId: number, body: unknown) {
    const input = bodyObject(body);
    const branchId = id(input.branchId), groupId = id(input.groupId);
    const reason = input.reason ? name(input.reason, 500) : null;
    const transferDate = input.transferDate ? date(input.transferDate) : date(institutionToday());
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{id:number}[]>`SELECT "id" FROM "AcademicEnrollment" WHERE "id"=${enrollmentId} FOR UPDATE`;
      if (!rows.length) throw new NotFoundException();
      const enrollment = await tx.enrollment.findUniqueOrThrow({ where: { id: enrollmentId }, include: { payments: true } });
      const destination = await tx.cycleGroup.findUnique({ where: { id: groupId }, include: { reusableGroup: true, pension: true } });
      if (!destination || destination.academicCycleId !== enrollment.academicCycleId || destination.reusableGroup.branchId !== branchId)
        throw new BadRequestException('Group must belong to branch and cycle');
      if (!(await tx.academicCycleBranch.findUnique({ where: { academicCycleId_branchId: { academicCycleId: enrollment.academicCycleId, branchId } } })))
        throw new BadRequestException('Branch unavailable for cycle');
      if (enrollment.branchId === branchId && enrollment.groupId === groupId)
        throw new BadRequestException('Enrollment location unchanged');
      if (!destination.pension) throw new BadRequestException('Group pension required');
      const discountPercent = enrollment.pensionDiscountPercent ?? new Prisma.Decimal(0);
      const discountAmount = destination.pension.amount.mul(discountPercent).div(100).toDecimalPlaces(2);
      const currentPeriod = transferDate.toISOString().slice(0, 7);
      const paidPeriods = new Set(enrollment.payments.filter((p) => p.paymentType === 'PENSION').map((p) => p.period));
      const changeable = await tx.pensionObligation.findMany({ where: { enrollmentId, period: { gte: currentPeriod, notIn: [...paidPeriods].filter((p): p is string => !!p) } } });
      for (const obligation of changeable) {
        const [year, month] = obligation.period.split('-').map(Number);
        const day = Math.min(destination.pension.dueDay, new Date(Date.UTC(year, month, 0)).getUTCDate());
        await tx.pensionObligation.update({ where: { id: obligation.id }, data: {
          name: destination.pension.name, baseAmount: destination.pension.amount, discountAmount,
          amount: destination.pension.amount.minus(discountAmount),
          dueDate: new Date(`${obligation.period}-${String(day).padStart(2, '0')}T00:00:00.000Z`),
        } });
      }
      await tx.enrollmentTransfer.create({ data: { enrollmentId, previousBranchId: enrollment.branchId, previousGroupId: enrollment.groupId, newBranchId: branchId, newGroupId: groupId, transferDate, reason } });
      return tx.enrollment.update({ where: { id: enrollmentId }, data: {
        branchId, groupId, pensionName: destination.pension.name,
        pensionBaseAmount: destination.pension.amount, pensionDiscountAmount: discountAmount,
        pensionAmount: destination.pension.amount.minus(discountAmount), pensionDueDay: destination.pension.dueDay,
      }, include: enrollmentInclude });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  private rethrowConflict(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ['P2002', 'P2003', 'P2034'].includes(error.code)
    )
      throw new ConflictException('Already exists');
    throw error;
  }
}
