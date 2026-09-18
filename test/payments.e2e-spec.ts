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

type BalanceResult = {
  rows: {
    id: number;
    amountDue: string;
    amountPaid: string;
    balance: string;
    status: string;
  }[];
  totals: { amountDue: string; amountPaid: string; balance: string };
};
describe('Enrollment payments (PostgreSQL)', () => {
  let app: INestApplication<App>, prisma: PrismaService;
  let admin: string[], student: string[], teacher: string[];
  let cycleId: number, enrollmentId: number, freeId: number;
  const prefix = `payments-test-${randomUUID()}`;
  const get = (path: string, cookie = admin) =>
    request(app.getHttpServer())
      .get(`/api/admin/payments${path}`)
      .set('Cookie', cookie);
  const post = (body: unknown, cookie = admin, id = enrollmentId) =>
    request(app.getHttpServer())
      .post(`/api/admin/payments/enrollments/${id}`)
      .set('Cookie', cookie)
      .set('X-Requested-With', 'Aristoteles')
      .send(body as object);
  const payment = {
    amount: '200',
    paymentDate: '2026-09-13',
    paymentMethod: 'TRANSFER',
    reference: 'R-123',
    notes: 'First payment',
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    let studentId = 0;
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
        student = cookie;
        studentId = user.id;
      }
      if (role === 'TEACHER') teacher = cookie;
    }
    const cycle = await prisma.academicCycle.create({
      data: {
        name: prefix,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
      },
    });
    cycleId = cycle.id;
    const group = await prisma.cycleGroup.create({
      data: {
        reusableGroup: { create: { name: prefix } },
        academicCycle: { connect: { id: cycleId } },
      },
    });
    const fee = await prisma.enrollmentFee.create({
      data: {
        cycleGroups: { connect: { id: group.id } },
        name: 'Regular',
        amount: 600,
        validFrom: new Date('2020-01-01'),
      },
    });
    enrollmentId = (
      await prisma.enrollment.create({
        data: {
          studentId,
          academicCycleId: cycleId,
          groupId: group.id,
          feeId: fee.id,
          baseAmount: 600,
          discountAmount: 100,
          finalAmount: 500,
        },
      })
    ).id;
    const freeUser = await prisma.user.create({
      data: {
        username: `${prefix}-free`,
        fullName: 'Free student',
        role: 'STUDENT',
        passwordHash: await hashPassword('test2026'),
      },
    });
    freeId = (
      await prisma.enrollment.create({
        data: {
          studentId: freeUser.id,
          academicCycleId: cycleId,
          groupId: group.id,
          feeId: fee.id,
          baseAmount: 600,
          discountAmount: 600,
          finalAmount: 0,
        },
      })
    ).id;
  });
  afterAll(async () => {
    if (prisma) {
      await prisma.payment.deleteMany({
        where: { enrollment: { academicCycle: { name: prefix } } },
      });
      await prisma.enrollment.deleteMany({
        where: { academicCycle: { name: prefix } },
      });
      await prisma.enrollmentFee.deleteMany({
        where: { cycleGroups: { some: { academicCycle: { name: prefix } } } },
      });
      await prisma.cycleGroup.deleteMany({
        where: { academicCycle: { name: prefix } },
      });
      await prisma.group.deleteMany({ where: { name: prefix } });
      await prisma.academicCycle.deleteMany({ where: { name: prefix } });
      await prisma.user.deleteMany({
        where: { username: { startsWith: prefix } },
      });
    }
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
  });
  it('protects balances, registration and history for ADMIN only', async () => {
    for (const path of [`/cycles/${cycleId}`, `/enrollments/${enrollmentId}`]) {
      await request(app.getHttpServer())
        .get(`/api/admin/payments${path}`)
        .expect(401);
      for (const cookie of [student, teacher])
        await get(path, cookie).expect(403);
    }
    for (const cookie of [student, teacher])
      await post(payment, cookie).expect(403);
  });
  it('uses enrollment finalAmount and treats zero due as paid', async () => {
    const result = await get(`/cycles/${cycleId}`).expect(200);
    const data = result.body as BalanceResult;
    expect(data.totals).toEqual({
      amountDue: '500',
      amountPaid: '0',
      balance: '500',
    });
    expect(data.rows.find((row) => row.id === enrollmentId)?.status).toBe(
      'PENDING',
    );
    expect(data.rows.find((row) => row.id === freeId)?.status).toBe('PAID');
    expect(JSON.stringify(data)).not.toContain('passwordHash');
    await post(payment, admin, freeId).expect(409);
  });
  it('validates amounts, dates, methods and missing enrollments', async () => {
    for (const changes of [
      { amount: 0 },
      { amount: -1 },
      { amount: '1.001' },
      { amount: 'NaN' },
      { paymentDate: '2026-02-30' },
      { paymentMethod: 'INVALID' },
      { reference: {} },
    ])
      await post({ ...payment, ...changes }).expect(400);
    await post({ ...payment, amount: '500.01' }).expect(409);
    await post(payment, admin, 2147483647).expect(404);
    await get('/enrollments/2147483647').expect(404);
    await get('/cycles/2147483647').expect(404);
  });
  it('records a partial payment and returns history and totals', async () => {
    await post({
      ...payment,
      amountDue: '1',
      balance: '0',
      enrollmentId: freeId,
    }).expect(201);
    const response = await get(`/cycles/${cycleId}`).expect(200);
    const data = response.body as BalanceResult;
    expect(data.totals).toEqual({
      amountDue: '500',
      amountPaid: '200',
      balance: '300',
    });
    expect(data.rows.find((row) => row.id === enrollmentId)?.status).toBe(
      'PARTIAL',
    );
    const history = await get(`/enrollments/${enrollmentId}`).expect(200);
    expect(history.body as unknown).toEqual([
      expect.objectContaining({
        enrollmentId,
        amount: '200',
        paymentMethod: 'TRANSFER',
        reference: 'R-123',
        notes: 'First payment',
      }),
    ]);
  });
  it('serializes concurrent requests to prevent overpayment', async () => {
    const results = await Promise.all([
      post({ ...payment, amount: '200' }),
      post({ ...payment, amount: '200' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const data = (await get(`/cycles/${cycleId}`).expect(200))
      .body as BalanceResult;
    expect(data.totals.balance).toBe('100');
  });
  it('settles decimal payments exactly, marks PAID, and rejects further payments', async () => {
    await post({ ...payment, amount: '99.99' }).expect(201);
    await post({ ...payment, amount: '0.01' }).expect(201);
    const data = (await get(`/cycles/${cycleId}`).expect(200))
      .body as BalanceResult;
    expect(data.totals).toEqual({
      amountDue: '500',
      amountPaid: '500',
      balance: '0',
    });
    expect(data.rows.find((row) => row.id === enrollmentId)?.status).toBe(
      'PAID',
    );
    await post({ ...payment, amount: '0.01' }).expect(409);
    const enrollment = await prisma.enrollment.findUniqueOrThrow({
      where: { id: enrollmentId },
    });
    expect(enrollment.baseAmount.toString()).toBe('600');
    expect(enrollment.discountAmount.toString()).toBe('100');
    expect(enrollment.finalAmount.toString()).toBe('500');
  });
});
