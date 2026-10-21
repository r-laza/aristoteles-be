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
  const receiptPost = (id: number, body: unknown, cookie = admin) =>
    request(app.getHttpServer())
      .post(`/api/admin/payments/${id}/receipt`)
      .set('Cookie', cookie)
      .set('X-Requested-With', 'Aristoteles')
      .send(body as object);
  const payment = {
    amount: '200',
    paymentDate: '2026-09-13',
    paymentMethod: 'TRANSFER',
    reference: 'R-123',
    notes: 'First payment',
    payerName: 'Juan Pérez García',
    payerDocumentType: 'DNI',
    payerDocumentNumber: '76372489',
    payerRelationship: 'OTHER',
    payerRelationshipOther: 'Esposa',
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
        studentId = (
          await prisma.student.create({
            data: {
              userId: user.id,
              fullName: 'Payment student',
              initials: 'PS',
              dni: `${prefix}-student`,
              firstName: 'Payment',
              lastName: 'Student',
              birthDate: new Date('2010-01-01'),
              gender: 'OTHER',
              representativeName: 'Representative',
              relationship: 'OTHER',
              relationshipOther: 'Other',
              primaryPhone: '0000000000',
            },
          })
        ).id;
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
          studentId: (
            await prisma.student.create({
              data: {
                userId: freeUser.id,
                fullName: 'Free student',
                initials: 'FS',
                dni: `${prefix}-free`,
                firstName: 'Free',
                lastName: 'Student',
                birthDate: new Date('2010-01-01'),
                gender: 'OTHER',
                representativeName: 'Representative',
                relationship: 'OTHER',
                relationshipOther: 'Other',
                primaryPhone: '0000000000',
              },
            })
          ).id,
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
      await prisma.student.deleteMany({
        where: { dni: { startsWith: prefix } },
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
  it('creates one persisted, idempotent receipt for an existing payment', async () => {
    const history = await get(`/enrollments/${enrollmentId}`).expect(200);
    const paymentId = (history.body as { id: number }[])[0].id;
    const input = {
      payerName: payment.payerName,
      payerDocumentType: payment.payerDocumentType,
      payerDocumentNumber: payment.payerDocumentNumber,
      payerRelationship: payment.payerRelationship,
      payerRelationshipOther: payment.payerRelationshipOther,
    };
    await receiptPost(paymentId, input, student).expect(403);
    await request(app.getHttpServer())
      .get(`/api/admin/payments/${paymentId}/receipt`)
      .expect(401);
    for (const invalid of [
      { ...input, payerName: '' },
      { ...input, payerDocumentType: 'INVALID' },
      { ...input, payerDocumentNumber: '123' },
      { ...input, payerRelationship: 'INVALID' },
    ])
      await receiptPost(paymentId, invalid).expect(400);
    await receiptPost(2147483647, input).expect(404);

    const created = await receiptPost(paymentId, input).expect(201);
    const createdBody = created.body as unknown as {
      paymentId: number;
      receiptNumber: string;
      payer: {
        name: string;
        documentType: string;
        documentNumber: string;
        relationship: string;
        relationshipOther: string | null;
      };
      student: { name: string };
      payment: { amount: string };
      obligation: {
        paymentType: string;
        originalAmount: string;
        discountAmount: string;
        paidAmount: string;
      };
    };
    expect(createdBody.paymentId).toBe(paymentId);
    expect(createdBody.receiptNumber).toMatch(/^REC-\d{4}-\d{6}$/);
    expect(createdBody.payer).toEqual({
      name: input.payerName,
      documentType: input.payerDocumentType,
      documentNumber: input.payerDocumentNumber,
      relationship: input.payerRelationship,
      relationshipOther: input.payerRelationshipOther,
    });
    expect(createdBody.student.name).toBe('Payment student');
    expect(createdBody.payment.amount).toBe('200');
    expect(createdBody.obligation).toEqual({
      paymentType: 'ENROLLMENT',
      originalAmount: '600',
      discountAmount: '100',
      paidAmount: '200',
      name: 'Regular',
      period: null,
    });
    const downloaded = await request(app.getHttpServer())
      .get(`/api/admin/payments/${paymentId}/receipt`)
      .set('Cookie', admin)
      .expect(200);
    expect(downloaded.body as unknown).toEqual(createdBody);
    const repeated = await receiptPost(paymentId, {
      ...input,
      payerName: 'Different payer',
    }).expect(201);
    expect(repeated.body as unknown).toEqual(createdBody);
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
  it('separates pension periods from a settled enrollment and prevents concurrent period overpayment', async () => {
    await prisma.enrollment.update({
      where: { id: enrollmentId },
      data: {
        pensionAmount: '80.50',
        pensionDueDay: 10,
        pensionStartDate: new Date('2020-01-01'),
        pensionEndDate: new Date('2020-02-29'),
      },
    });
    const pensionPayment = {
      ...payment,
      paymentType: 'PENSION',
      period: '2020-01',
      amount: '30.25',
    };
    await post({ ...pensionPayment, period: '2020-03' }).expect(400);
    await post({ ...pensionPayment, period: '2020-13' }).expect(400);
    await post({ ...pensionPayment, period: null }).expect(400);
    await post({ ...pensionPayment, paymentType: 'INVALID' }).expect(400);
    await post({ ...pensionPayment, paymentType: 'ENROLLMENT' }).expect(400);
    await post(pensionPayment, admin, freeId).expect(400);
    await post(pensionPayment).expect(201);
    const results = await Promise.all([
      post({ ...pensionPayment, amount: '50.25' }),
      post({ ...pensionPayment, amount: '50.25' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const response = await get(`/cycles/${cycleId}`).expect(200);
    const data = response.body as BalanceResult & {
      rows: {
        id: number;
        obligations: {
          paymentType: string;
          period: string | null;
          balance: string;
          status: string;
        }[];
      }[];
    };
    const row = data.rows.find((r) => r.id === enrollmentId)!;
    expect(row.amountPaid).toBe('580.5');
    expect(row.balance).toBe('80.5');
    expect(row.status).toBe('OVERDUE');
    expect(row.obligations).toEqual([
      expect.objectContaining({
        paymentType: 'ENROLLMENT',
        balance: '0',
        status: 'PAID',
      }),
      expect.objectContaining({
        period: '2020-01',
        balance: '0',
        status: 'PAID',
      }),
      expect.objectContaining({
        period: '2020-02',
        balance: '80.5',
        status: 'OVERDUE',
      }),
    ]);
    await post({ ...pensionPayment, amount: '0.01' }).expect(409);
    await post({
      ...pensionPayment,
      period: '2020-02',
      amount: '80.50',
    }).expect(201);
    const settled = (await get(`/cycles/${cycleId}`).expect(200))
      .body as BalanceResult;
    expect(settled.rows.find((r) => r.id === enrollmentId)?.status).toBe(
      'PAID',
    );
    await prisma.enrollment.update({
      where: { id: enrollmentId },
      data: { pensionEndDate: new Date('2020-04-30') },
    });
    const multiple = {
      ...pensionPayment,
      period: null,
      periods: ['2020-03', '2020-04'],
      amount: '161.00',
    };
    await post({ ...multiple, amount: '160.99' }).expect(400);
    const registered = await post(multiple).expect(201);
    expect(registered.body as unknown).toEqual(
      expect.objectContaining({
        totalAmount: '161',
        obligationCount: 2,
        payments: [
          expect.objectContaining({ period: '2020-03', amount: '80.5' }),
          expect.objectContaining({ period: '2020-04', amount: '80.5' }),
        ],
      }),
    );
    await post(multiple).expect(409);
    const multiSettled = (await get(`/cycles/${cycleId}`).expect(200))
      .body as BalanceResult;
    expect(multiSettled.rows.find((r) => r.id === enrollmentId)?.status).toBe(
      'PAID',
    );
    const history = await get(`/enrollments/${enrollmentId}`).expect(200);
    expect(history.body as unknown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          paymentType: 'PENSION',
          period: '2020-02',
          amount: '80.5',
        }),
        expect.objectContaining({
          paymentType: 'ENROLLMENT',
          period: null,
          amount: '200',
        }),
      ]),
    );
  });
});
