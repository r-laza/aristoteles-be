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
  group: true,
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
  create(body: unknown) {
    const input = bodyObject(body);
    const startDate = date(input.startDate),
      endDate = date(input.endDate);
    if (endDate < startDate)
      throw new BadRequestException('Invalid date range');
    return this.prisma.academicCycle.create({
      data: {
        name: name(input.name),
        startDate,
        endDate,
        baseEnrollmentAmount: money(input.baseEnrollmentAmount),
      },
      include: cycleInclude,
    });
  }
  async groups(cycleId: number) {
    await this.detail(cycleId);
    return this.prisma.group.findMany({
      where: { academicCycleId: cycleId },
      include: { _count: { select: { enrollments: true } } },
      orderBy: { name: 'asc' },
    });
  }
  async createGroup(cycleId: number, body: unknown) {
    await this.detail(cycleId);
    try {
      return await this.prisma.group.create({
        data: { academicCycleId: cycleId, name: name(bodyObject(body).name) },
      });
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
    return this.prisma.enrollment.findMany({
      where: { academicCycleId: cycleId },
      include: enrollmentInclude,
      orderBy: { createdAt: 'desc' },
    });
  }
  async enroll(cycleId: number, body: unknown) {
    const input = bodyObject(body);
    const studentId = id(input.studentId),
      groupId = id(input.groupId);
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
        const group = await tx.group.findUnique({ where: { id: groupId } });
        if (!group || group.academicCycleId !== cycleId)
          throw new BadRequestException('Group must belong to cycle');
        const baseAmount = cycle.baseEnrollmentAmount;
        if (discountAmount.greaterThan(baseAmount))
          throw new BadRequestException('Discount exceeds base amount');
        return tx.enrollment.create({
          data: {
            studentId,
            academicCycleId: cycleId,
            groupId,
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
      error.code === 'P2002'
    )
      throw new ConflictException('Already exists');
    throw error;
  }
}
