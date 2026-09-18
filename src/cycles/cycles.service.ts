import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { publicUserSelect } from '../auth/auth.types';

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
  _count: { select: { enrollments: true, groups: true } },
} as const;
const enrollmentInclude = {
  student: { select: publicUserSelect },
  group: { include: { reusableGroup: true } },
  fee: true,
} as const;

@Injectable()
export class CyclesService {
  constructor(private readonly prisma: PrismaService) {}
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
    const assignments = input.groups.map((value: unknown) => {
      const row = bodyObject(value);
      if (!Array.isArray(row.feeIds) || row.feeIds.length !== 1)
        throw new BadRequestException('Exactly one fee per group is required');
      const feeIds = row.feeIds.map(id);
      if (new Set(feeIds).size !== feeIds.length)
        throw new BadRequestException();
      return { groupId: id(row.groupId), feeIds };
    });
    if (
      new Set(assignments.map((row) => row.groupId)).size !== assignments.length
    )
      throw new BadRequestException();
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          for (const row of assignments) {
            if (
              !(await tx.group.findUnique({ where: { id: row.groupId } })) ||
              (await tx.enrollmentFee.count({
                where: { id: { in: row.feeIds } },
              })) !== row.feeIds.length
            )
              throw new BadRequestException('Unknown group or fee');
          }
          if (
            cycleId !== undefined &&
            !(await tx.academicCycle.findUnique({ where: { id: cycleId } }))
          )
            throw new NotFoundException();
          const data = { name: cycleName, startDate, endDate };
          const cycle =
            cycleId === undefined
              ? await tx.academicCycle.create({ data })
              : await tx.academicCycle.update({ where: { id: cycleId }, data });
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
            const fees = row.feeIds.map((id) => ({ id }));
            await tx.cycleGroup.upsert({
              where: {
                academicCycleId_reusableGroupId: {
                  academicCycleId: cycle.id,
                  reusableGroupId: row.groupId,
                },
              },
              create: {
                academicCycleId: cycle.id,
                reusableGroupId: row.groupId,
                fees: { connect: fees },
              },
              update: { fees: { set: fees } },
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
  reusableFees() {
    return this.prisma.enrollmentFee.findMany({
      include: { _count: { select: { cycleGroups: true, enrollments: true } } },
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
            _count: { select: { cycleGroups: true, enrollments: true } },
          },
        });
        if (fee._count.cycleGroups || fee._count.enrollments)
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
    await this.detail(cycleId);
    const groups = await this.prisma.cycleGroup.findMany({
      where: { academicCycleId: cycleId },
      include: {
        reusableGroup: true,
        fees: { orderBy: [{ validFrom: 'desc' }, { id: 'desc' }] },
        _count: { select: { enrollments: true } },
      },
      orderBy: { reusableGroup: { name: 'asc' } },
    });
    return groups.map((group) => ({
      ...group,
      name: group.reusableGroup.name,
    }));
  }
  reusableGroups() {
    return this.prisma.group.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { cycles: true } } },
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
    const data = { name: name(bodyObject(body).name) };
    try {
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
    return this.prisma.user.findMany({
      where: {
        role: 'STUDENT',
        isActive: true,
        enrollments: { none: { academicCycleId: cycleId } },
      },
      select: publicUserSelect,
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
    const studentId = id(input.studentId),
      groupId = id(input.groupId);
    const feeId = id(input.feeId);
    const discountAmount = money(input.discountAmount ?? 0);
    const discountReason =
      input.discountReason === undefined || input.discountReason === ''
        ? null
        : name(input.discountReason, 500);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const cycle = await tx.academicCycle.findUnique({
          where: { id: cycleId },
        });
        if (!cycle) throw new NotFoundException();
        const student = await tx.user.findUnique({
          where: { id: studentId },
          select: { role: true, isActive: true },
        });
        if (!student || student.role !== 'STUDENT' || !student.isActive)
          throw new BadRequestException('Student required');
        const group = await tx.cycleGroup.findUnique({
          where: { id: groupId },
        });
        if (!group || group.academicCycleId !== cycleId)
          throw new BadRequestException('Group must belong to cycle');
        const fee = await tx.enrollmentFee.findUnique({ where: { id: feeId } });
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
          !(await tx.cycleGroup.count({
            where: { id: groupId, fees: { some: { id: feeId } } },
          })) ||
          fee.validFrom > today ||
          (fee.validUntil && fee.validUntil < today)
        )
          throw new BadRequestException('Fee unavailable for this group');
        const baseAmount = fee.amount;
        if (discountAmount.greaterThan(baseAmount))
          throw new BadRequestException('Discount exceeds base amount');
        return tx.enrollment.create({
          data: {
            studentId,
            academicCycleId: cycleId,
            groupId,
            feeId,
            baseAmount,
            discountAmount,
            discountReason,
            finalAmount: baseAmount.minus(discountAmount),
          },
          include: enrollmentInclude,
        });
      });
    } catch (error) {
      this.rethrowConflict(error);
    }
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
