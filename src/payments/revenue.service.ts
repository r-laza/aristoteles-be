import { BadRequestException, Injectable } from '@nestjs/common';
import { AdminLevel, PaymentMethod, Prisma } from '@prisma/client';
import type { PublicUser } from '../auth/auth.types';
import { PrismaService } from '../database/prisma.service';

const METHODS = [
  PaymentMethod.CASH,
  PaymentMethod.TRANSFER,
  PaymentMethod.YAPE,
  PaymentMethod.PLIN,
] as const;

function positiveInt(value: unknown, fallback?: number) {
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0)
    throw new BadRequestException('Invalid filter');
  return number;
}

function date(value: unknown) {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new BadRequestException('Invalid date');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (parsed.toISOString().slice(0, 10) !== value)
    throw new BadRequestException('Invalid date');
  return parsed;
}

@Injectable()
export class RevenueService {
  constructor(private readonly prisma: PrismaService) {}

  async report(actor: PublicUser, query: Record<string, unknown>) {
    const page = positiveInt(query.page, 1)!;
    const pageSize = Math.min(positiveInt(query.pageSize, 20)!, 100);
    const administratorId = positiveInt(query.administratorId);
    const cycleId = positiveInt(query.cycleId);
    const branchId = positiveInt(query.branchId);
    const from = date(query.from);
    const to = date(query.to);
    if (from && to && from > to) throw new BadRequestException('Invalid range');
    const method = query.paymentMethod;
    if (
      method !== undefined &&
      method !== '' &&
      !METHODS.includes(method as (typeof METHODS)[number])
    )
      throw new BadRequestException('Invalid payment method');
    const search =
      typeof query.search === 'string' ? query.search.trim().slice(0, 100) : '';
    const isMain = actor.adminLevel === AdminLevel.MAIN;
    const where: Prisma.PaymentWhereInput = {
      collectorId: isMain ? administratorId : actor.id,
      paymentMethod: method ? (method as PaymentMethod) : undefined,
      paymentDate:
        from || to ? { gte: from, lte: to } : undefined,
      OR: branchId
        ? [
            { registeredBranchId: branchId },
            { registeredBranchId: null, enrollment: { branchId } },
          ]
        : undefined,
      enrollment: {
        academicCycleId: cycleId,
        student: search
          ? {
              OR: [
                { fullName: { contains: search, mode: 'insensitive' } },
                { dni: { contains: search, mode: 'insensitive' } },
              ],
            }
          : undefined,
      },
    };
    const [payments, aggregate, count, cycles, branches, administrators] =
      await this.prisma.$transaction([
        this.prisma.payment.findMany({
          where,
          orderBy: [{ paymentDate: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            paymentDate: true,
            paymentMethod: true,
            amount: true,
            branchName: true,
            collector: { select: { id: true, fullName: true } },
            enrollment: {
              select: {
                student: { select: { id: true, fullName: true, dni: true } },
                academicCycle: { select: { id: true, name: true } },
                branch: { select: { id: true, name: true } },
              },
            },
          },
        }),
        this.prisma.payment.aggregate({ where, _sum: { amount: true } }),
        this.prisma.payment.count({ where }),
        this.prisma.academicCycle.findMany({
          orderBy: { startDate: 'desc' },
          select: { id: true, name: true },
        }),
        this.prisma.branch.findMany({
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        }),
        isMain
          ? this.prisma.user.findMany({
              where: { role: 'ADMIN' },
              orderBy: { fullName: 'asc' },
              select: { id: true, fullName: true },
            })
          : this.prisma.user.findMany({ where: { id: -1 }, select: { id: true, fullName: true } }),
      ]);
    return {
      rows: payments.map((payment) => ({
        id: payment.id,
        date: payment.paymentDate,
        administrator: payment.collector,
        student: payment.enrollment.student,
        cycle: payment.enrollment.academicCycle,
        branch: {
          ...payment.enrollment.branch,
          name: payment.branchName ?? payment.enrollment.branch.name,
        },
        paymentMethod: payment.paymentMethod,
        amount: payment.amount,
      })),
      totals: { amount: aggregate._sum.amount ?? new Prisma.Decimal(0), count },
      pagination: {
        page,
        pageSize,
        total: count,
        pages: Math.max(1, Math.ceil(count / pageSize)),
      },
      filters: { cycles, branches, administrators },
    };
  }
}
