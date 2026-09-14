import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { hashPassword } from '../src/auth/password';

describe('Academic cycle enrollment (PostgreSQL)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const prefix = `cycles-test-${randomUUID()}`;
  let admin: string[], studentCookie: string[], teacherCookie: string[];
  let studentId: number, teacherId: number;
  let cycleId: number, otherId: number, groupId: number, otherGroupId: number;
  const post = (path: string, cookie = admin) =>
    request(app.getHttpServer())
      .post(`/api/admin/cycles${path}`)
      .set('X-Requested-With', 'Aristoteles')
      .set('Cookie', cookie);
  const get = (path: string, cookie = admin) =>
    request(app.getHttpServer())
      .get(`/api/admin/cycles${path}`)
      .set('Cookie', cookie);
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    for (const role of ['ADMIN', 'STUDENT', 'TEACHER'] as const) {
      const user = await prisma.user.create({
        data: {
          username: `${prefix}-${role}`,
          fullName: role,
          role,
          passwordHash: await hashPassword('test2026'),
        },
      });
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('X-Requested-With', 'Aristoteles')
        .send({ username: user.username, password: 'test2026', role })
        .expect(200);
      const cookie = response.headers['set-cookie'] as unknown as string[];
      if (role === 'ADMIN') admin = cookie;
      if (role === 'STUDENT') {
        studentCookie = cookie;
        studentId = user.id;
      }
      if (role === 'TEACHER') {
        teacherCookie = cookie;
        teacherId = user.id;
      }
    }
  });
  afterAll(async () => {
    if (prisma) {
      const where = { academicCycle: { name: { startsWith: prefix } } };
      await prisma.enrollment.deleteMany({ where });
      await prisma.group.deleteMany({ where });
      await prisma.academicCycle.deleteMany({
        where: { name: { startsWith: prefix } },
      });
      await prisma.user.deleteMany({
        where: { username: { startsWith: prefix } },
      });
    }
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
  });
  it('creates persisted cycles and groups, validates dates and money', async () => {
    for (const input of [
      { startDate: '2026-02-30' },
      { endDate: '2025-01-01' },
      { baseEnrollmentAmount: -1 },
      { baseEnrollmentAmount: '1.001' },
    ]) {
      await post('')
        .send({
          name: prefix,
          startDate: '2026-03-01',
          endDate: '2027-02-28',
          baseEnrollmentAmount: '600.00',
          ...input,
        })
        .expect(400);
    }
    for (const suffix of ['main', 'other']) {
      const response = await post('')
        .send({
          name: `${prefix}-${suffix}`,
          startDate: '2026-03-01',
          endDate: '2027-02-28',
          baseEnrollmentAmount: '600.00',
        })
        .expect(201);
      const cycle = response.body as { id: number };
      const groupResponse = await post(`/${cycle.id}/groups`)
        .send({ name: 'Leones' })
        .expect(201);
      const group = groupResponse.body as { id: number };
      if (suffix === 'main') {
        cycleId = cycle.id;
        groupId = group.id;
      } else {
        otherId = cycle.id;
        otherGroupId = group.id;
      }
      await post(`/${cycle.id}/groups`).send({ name: 'Leones' }).expect(409);
    }
    await get(`/${cycleId}`).expect(200);
    await get('/2147483647').expect(404);
    await get('/not-an-id').expect(400);
  });
  it('denies non-admin access to every cycle endpoint', async () => {
    for (const path of [
      '',
      `/${cycleId}`,
      `/${cycleId}/groups`,
      `/${cycleId}/available-students`,
      `/${cycleId}/enrollments`,
    ]) {
      await request(app.getHttpServer())
        .get(`/api/admin/cycles${path}`)
        .expect(401);
      await get(path, studentCookie).expect(403);
      await get(path, teacherCookie).expect(403);
    }
    for (const path of ['', `/${cycleId}/groups`, `/${cycleId}/enrollments`]) {
      await post(path, studentCookie).send({}).expect(403);
      await post(path, teacherCookie).send({}).expect(403);
    }
  });
  it('validates student role, group ownership, discount and active accounts', async () => {
    const valid = { studentId, groupId, discountAmount: '100' };
    for (const input of [
      { studentId: teacherId },
      { groupId: otherGroupId },
      { discountAmount: '-1' },
      { discountAmount: '601' },
      { discountAmount: '0.001' },
      { studentId: 'wrong' },
    ]) {
      await post(`/${cycleId}/enrollments`)
        .send({ ...valid, ...input })
        .expect(400);
    }
    await prisma.user.update({
      where: { id: studentId },
      data: { isActive: false },
    });
    await post(`/${cycleId}/enrollments`).send(valid).expect(400);
    await prisma.user.update({
      where: { id: studentId },
      data: { isActive: true },
    });
  });
  it('copies the base, computes the final total, filters available students and prevents racing duplicates', async () => {
    const before = await get(`/${cycleId}/available-students`).expect(200);
    expect(
      (before.body as { id: number }[]).some((u) => u.id === studentId),
    ).toBe(true);
    const payload = {
      studentId,
      groupId,
      discountAmount: '100',
      discountReason: 'Descuento especial',
      baseAmount: '1',
      finalAmount: '0',
      status: 'INVALID',
    };
    const responses = await Promise.all([
      post(`/${cycleId}/enrollments`).send(payload),
      post(`/${cycleId}/enrollments`).send(payload),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const stored = await prisma.enrollment.findUniqueOrThrow({
      where: {
        studentId_academicCycleId: { studentId, academicCycleId: cycleId },
      },
    });
    expect(stored.baseAmount.toString()).toBe('600');
    expect(stored.discountAmount.toString()).toBe('100');
    expect(stored.finalAmount.toString()).toBe('500');
    expect(stored.status).toBe('ACTIVE');
    const after = await get(`/${cycleId}/available-students`).expect(200);
    expect(
      (after.body as { id: number }[]).some((u) => u.id === studentId),
    ).toBe(false);
    expect(JSON.stringify(after.body)).not.toContain('passwordHash');
    const list = await get(`/${cycleId}/enrollments`).expect(200);
    expect(JSON.stringify(list.body)).not.toContain('passwordHash');
    // Enrollment from either admin screen must immediately appear in payments.
    const balances = await request(app.getHttpServer())
      .get(`/api/admin/payments/cycles/${cycleId}`)
      .set('Cookie', admin)
      .expect(200);
    expect(balances.body as unknown).toEqual(
      expect.objectContaining({
        rows: [
          expect.objectContaining({
            id: stored.id,
            baseAmount: '600',
            discountAmount: '100',
            amountDue: '500',
            amountPaid: '0',
            balance: '500',
            status: 'PENDING',
          }),
        ],
        totals: { amountDue: '500', amountPaid: '0', balance: '500' },
      }),
    );
    const detail = await get(`/${cycleId}`).expect(200);
    expect(
      (detail.body as { _count: { enrollments: number } })._count.enrollments,
    ).toBe(1);
    const groups = await get(`/${cycleId}/groups`).expect(200);
    expect(
      (groups.body as { _count: { enrollments: number } }[])[0]._count
        .enrollments,
    ).toBe(1);
    await prisma.academicCycle.update({
      where: { id: cycleId },
      data: { baseEnrollmentAmount: 900 },
    });
    expect(
      (
        await prisma.enrollment.findUniqueOrThrow({ where: { id: stored.id } })
      ).baseAmount.toString(),
    ).toBe('600');
  });
  it('allows the same student in another cycle and defaults discount to zero', async () => {
    await post(`/${otherId}/enrollments`)
      .send({ studentId, groupId: otherGroupId })
      .expect(201);
    const stored = await prisma.enrollment.findUniqueOrThrow({
      where: {
        studentId_academicCycleId: { studentId, academicCycleId: otherId },
      },
    });
    expect(stored.discountAmount.toString()).toBe('0');
    expect(stored.finalAmount.toString()).toBe('600');
  });
});
