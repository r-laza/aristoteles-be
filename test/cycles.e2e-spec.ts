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
  let reusableId: number, betaId: number, feeId: number, otherFeeId: number;
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
  const groupPost = (path = '', cookie = admin) =>
    request(app.getHttpServer())
      .post(`/api/admin/groups${path}`)
      .set('X-Requested-With', 'Aristoteles')
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
      await prisma.payment.deleteMany({ where: { enrollment: where } });
      await prisma.enrollment.deleteMany({ where });
      await prisma.enrollmentFee.deleteMany({
        where: { name: { startsWith: prefix } },
      });
      await prisma.cycleGroup.deleteMany({ where });
      await prisma.group.deleteMany({
        where: { name: { startsWith: prefix } },
      });
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
  const feePost = (path = '', cookie = admin) =>
    request(app.getHttpServer())
      .post(`/api/admin/fees${path}`)
      .set('X-Requested-With', 'Aristoteles')
      .set('Cookie', cookie);
  const payload = () => ({
    name: prefix,
    startDate: '2026-01-01',
    endDate: '2027-12-31',
    groups: [
      { groupId: reusableId, feeIds: [feeId] },
      { groupId: betaId, feeIds: [feeId] },
    ],
  });
  it('creates independent catalogs and reuses the same records across groups and cycles', async () => {
    reusableId = (
      (await groupPost().send({ name: prefix }).expect(201)).body as {
        id: number;
      }
    ).id;
    betaId = (
      (
        await groupPost()
          .send({ name: `${prefix}-beta` })
          .expect(201)
      ).body as { id: number }
    ).id;
    await groupPost().send({ name: prefix }).expect(409);
    feeId = (
      (
        await feePost()
          .send({
            name: `${prefix}-regular`,
            amount: '600',
            validFrom: '2020-01-01',
          })
          .expect(201)
      ).body as { id: number }
    ).id;
    otherFeeId = (
      (
        await feePost()
          .send({
            name: `${prefix}-siblings`,
            amount: '550',
            validFrom: '2020-01-01',
          })
          .expect(201)
      ).body as { id: number }
    ).id;
    expect(
      await prisma.cycleGroup.count({ where: { reusableGroupId: reusableId } }),
    ).toBe(0);
    cycleId = (
      (await post('').send(payload()).expect(201)).body as { id: number }
    ).id;
    otherId = (
      (
        await post('')
          .send({ ...payload(), name: `${prefix}-other` })
          .expect(201)
      ).body as { id: number }
    ).id;
    const groups = (await get(`/${cycleId}/groups`).expect(200)).body as {
      id: number;
      reusableGroupId: number;
      fees: { id: number }[];
    }[];
    groupId = groups.find((g) => g.reusableGroupId === reusableId)!.id;
    otherGroupId = groups.find((g) => g.reusableGroupId === betaId)!.id;
    expect(
      groups
        .find((g) => g.id === groupId)!
        .fees.map((f) => f.id)
        .sort(),
    ).toEqual([feeId]);
    expect(
      groups.find((g) => g.id === otherGroupId)!.fees.map((f) => f.id),
    ).toEqual([feeId]);
    expect(
      await prisma.enrollmentFee.count({
        where: { name: { startsWith: prefix } },
      }),
    ).toBe(2);
    expect(
      await prisma.group.count({ where: { name: { startsWith: prefix } } }),
    ).toBe(2);
  });
  it('rejects invalid or duplicate assignments atomically and validates dates and fees', async () => {
    for (const change of [
      { groups: [] },
      { groups: [{ groupId: reusableId, feeIds: [] }] },
      { groups: [{ groupId: reusableId, feeIds: [feeId, otherFeeId] }] },
      { groups: [{ groupId: reusableId, feeIds: [2147483647] }] },
      { groups: [{ groupId: 2147483647, feeIds: [feeId] }] },
      { groups: [{ groupId: reusableId, feeIds: [feeId, feeId] }] },
      { groups: [payload().groups[0], payload().groups[0]] },
      { startDate: '2026-02-30' },
      { endDate: '2025-01-01' },
      { name: ' ' },
    ]) {
      await post('')
        .send({ ...payload(), ...change })
        .expect(400);
      await post(`/${cycleId}`)
        .send({ ...payload(), ...change })
        .expect(400);
    }
    expect(
      await prisma.academicCycle.count({
        where: { name: { startsWith: prefix } },
      }),
    ).toBe(2);
    for (const change of [
      { amount: '-1' },
      { amount: '1.001' },
      { validFrom: '2026-02-30' },
      { validUntil: '2019-01-01' },
    ]) {
      await feePost()
        .send({
          name: prefix,
          amount: '600',
          validFrom: '2020-01-01',
          ...change,
        })
        .expect(400);
    }
    await get('/2147483647').expect(404);
    await post('/2147483647').send(payload()).expect(404);
  });
  it('enforces administrator permissions on catalogs and cycle writes', async () => {
    for (const path of [
      '/api/admin/fees',
      '/api/admin/groups',
      '/api/admin/cycles',
      `/api/admin/cycles/${cycleId}/groups`,
    ]) {
      await request(app.getHttpServer()).get(path).expect(401);
      for (const cookie of [studentCookie, teacherCookie])
        await request(app.getHttpServer())
          .get(path)
          .set('Cookie', cookie)
          .expect(403);
    }
    for (const cookie of [studentCookie, teacherCookie]) {
      await feePost('', cookie).send({}).expect(403);
      await feePost(`/${feeId}`, cookie).send({}).expect(403);
      await groupPost('', cookie).send({}).expect(403);
      await post('', cookie).send(payload()).expect(403);
      await post(`/${cycleId}`, cookie).send(payload()).expect(403);
      await post(`/${cycleId}/enrollments`, cookie).send({}).expect(403);
    }
  });
  it('validates assigned fees, students and discounts, and prevents duplicate enrollments', async () => {
    const valid = { studentId, groupId, feeId, discountAmount: '100' };
    for (const change of [
      { studentId: teacherId },
      { feeId: null },
      { discountAmount: '-1' },
      { discountAmount: '601' },
      { discountAmount: '0.001' },
      { groupId: otherGroupId, feeId: otherFeeId },
    ])
      await post(`/${cycleId}/enrollments`)
        .send({ ...valid, ...change })
        .expect(400);
    await prisma.user.update({
      where: { id: studentId },
      data: { isActive: false },
    });
    await post(`/${cycleId}/enrollments`).send(valid).expect(400);
    await prisma.user.update({
      where: { id: studentId },
      data: { isActive: true },
    });
    const responses = await Promise.all([
      post(`/${cycleId}/enrollments`).send(valid),
      post(`/${cycleId}/enrollments`).send(valid),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const stored = await prisma.enrollment.findUniqueOrThrow({
      where: {
        studentId_academicCycleId: { studentId, academicCycleId: cycleId },
      },
    });
    expect(stored.baseAmount.toString()).toBe('600');
    expect(stored.finalAmount.toString()).toBe('500');
    const available = await get(`/${cycleId}/available-students`).expect(200);
    expect(
      (available.body as { id: number }[]).some(
        (user) => user.id === studentId,
      ),
    ).toBe(false);
    expect(
      JSON.stringify((await get(`/${cycleId}/enrollments`)).body),
    ).not.toContain('passwordHash');
  });
  it('rejects expired and future fees and fees from another cycle assignment', async () => {
    const groups = (await get(`/${otherId}/groups`)).body as { id: number }[];
    await post(`/${cycleId}/enrollments`)
      .send({ studentId, groupId: groups[0].id, feeId })
      .expect(400);
    await post(`/${cycleId}`)
      .send({
        ...payload(),
        groups: [
          { groupId: reusableId, feeIds: [otherFeeId] },
          { groupId: betaId, feeIds: [feeId] },
        ],
      })
      .expect(201);
    for (const dates of [
      { validFrom: '9999-01-01', validUntil: '' },
      { validFrom: '2020-01-01', validUntil: '2020-01-01' },
    ]) {
      await feePost(`/${otherFeeId}`)
        .send({ name: `${prefix}-siblings`, amount: '550', ...dates })
        .expect(201);
      await post(`/${cycleId}/enrollments`)
        .send({ studentId, groupId, feeId: otherFeeId })
        .expect(400);
    }
    await feePost(`/${otherFeeId}`)
      .send({
        name: `${prefix}-siblings`,
        amount: '550',
        validFrom: '2020-01-01',
        validUntil: '',
      })
      .expect(201);
  });
  it('edits dates and assignments without duplicating records or changing historical amounts', async () => {
    await post(`/${cycleId}`)
      .send({ ...payload(), groups: [{ groupId: betaId, feeIds: [feeId] }] })
      .expect(409);
    expect((await get(`/${cycleId}/groups`)).body).toHaveLength(2);
    await post(`/${cycleId}`)
      .send({
        ...payload(),
        name: `${prefix}-edited`,
        endDate: '2028-01-01',
        groups: [{ groupId: reusableId, feeIds: [otherFeeId] }],
      })
      .expect(201);
    const groups = (await get(`/${cycleId}/groups`)).body as {
      id: number;
      fees: { id: number }[];
    }[];
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe(groupId);
    expect(groups[0].fees.map((f) => f.id)).toEqual([otherFeeId]);
    await post(`/${cycleId}/enrollments`)
      .send({ studentId, groupId, feeId })
      .expect(400);
    expect(
      await prisma.group.count({ where: { name: { startsWith: prefix } } }),
    ).toBe(2);
    await feePost(`/${feeId}`)
      .send({
        name: `${prefix}-updated`,
        amount: '700',
        validFrom: '2020-01-01',
      })
      .expect(201);
    const stored = await prisma.enrollment.findUniqueOrThrow({
      where: {
        studentId_academicCycleId: { studentId, academicCycleId: cycleId },
      },
    });
    expect(stored.baseAmount.toString()).toBe('600');
    expect(stored.finalAmount.toString()).toBe('500');
    const other = (await get(`/${otherId}/groups`)).body as {
      id: number;
      reusableGroupId: number;
      fees: { id: number; amount: string }[];
    }[];
    const assignment = other.find((g) => g.reusableGroupId === reusableId)!;
    expect(assignment.fees.find((f) => f.id === feeId)!.amount).toBe('700');
    await post(`/${otherId}/enrollments`)
      .send({ studentId, groupId: assignment.id, feeId })
      .expect(201);
    await post(`/${cycleId}`).send(payload()).expect(201);
    expect((await get(`/${cycleId}/groups`)).body).toHaveLength(2);
  });
  it('reports usage and only deletes unused fees after an administrator request', async () => {
    const catalog = await request(app.getHttpServer())
      .get('/api/admin/fees')
      .set('Cookie', admin)
      .expect(200);
    const listed = (
      catalog.body as {
        id: number;
        _count: { cycleGroups: number; enrollments: number };
      }[]
    ).find((f) => f.id === feeId)!;
    expect(listed._count.cycleGroups).toBe(4);
    expect(listed._count.enrollments).toBe(2);
    await feePost(`/${feeId}/delete`).send({}).expect(409);
    expect(
      await prisma.enrollmentFee.findUnique({ where: { id: feeId } }),
    ).not.toBeNull();
    const unused = (
      await feePost()
        .send({
          name: `${prefix}-unused`,
          amount: '300',
          validFrom: '2020-01-01',
        })
        .expect(201)
    ).body as { id: number };
    await request(app.getHttpServer())
      .post(`/api/admin/fees/${unused.id}/delete`)
      .set('X-Requested-With', 'Aristoteles')
      .send({})
      .expect(401);
    for (const cookie of [studentCookie, teacherCookie])
      await feePost(`/${unused.id}/delete`, cookie).send({}).expect(403);
    await feePost(`/${unused.id}/delete`).send({}).expect(201);
    expect(
      await prisma.enrollmentFee.findUnique({ where: { id: unused.id } }),
    ).toBeNull();
    await feePost(`/${unused.id}/delete`).send({}).expect(404);
  });
  it('protects historical enrollment fees even after every group assignment is replaced', async () => {
    for (const id of [cycleId, otherId]) {
      await post(`/${id}`)
        .send({
          ...payload(),
          groups: payload().groups.map((group) => ({
            ...group,
            feeIds: [otherFeeId],
          })),
        })
        .expect(201);
    }
    const fee = await prisma.enrollmentFee.findUniqueOrThrow({
      where: { id: feeId },
      include: { _count: { select: { cycleGroups: true, enrollments: true } } },
    });
    expect(fee._count.cycleGroups).toBe(0);
    expect(fee._count.enrollments).toBe(2);
    await feePost(`/${feeId}/delete`).send({}).expect(409);
    await feePost(`/${otherFeeId}/delete`).send({}).expect(409);
  });
  it('reports group cycle counts and protects assigned groups from deletion', async () => {
    const result = await request(app.getHttpServer())
      .get('/api/admin/groups')
      .set('Cookie', admin)
      .expect(200);
    const groups = result.body as { id: number; _count: { cycles: number } }[];
    expect(groups.find((group) => group.id === reusableId)!._count.cycles).toBe(
      2,
    );
    await groupPost(`/${reusableId}/delete`).send({}).expect(409);
    expect(
      await prisma.group.findUnique({ where: { id: reusableId } }),
    ).not.toBeNull();
    const unused = (
      await groupPost()
        .send({ name: `${prefix}-unused` })
        .expect(201)
    ).body as { id: number };
    await request(app.getHttpServer())
      .post(`/api/admin/groups/${unused.id}/delete`)
      .set('X-Requested-With', 'Aristoteles')
      .send({})
      .expect(401);
    for (const cookie of [studentCookie, teacherCookie])
      await groupPost(`/${unused.id}/delete`, cookie).send({}).expect(403);
    await groupPost(`/${unused.id}/delete`).send({}).expect(201);
    expect(
      await prisma.group.findUnique({ where: { id: unused.id } }),
    ).toBeNull();
    await groupPost(`/${unused.id}/delete`).send({}).expect(404);
  });
  it('deletes an unoccupied cycle without deleting reusable catalogs and enforces permissions', async () => {
    const result = (
      await post('')
        .send({ ...payload(), name: `${prefix}-delete` })
        .expect(201)
    ).body as { id: number };
    for (const cookie of [studentCookie, teacherCookie])
      await post(`/${result.id}/delete`, cookie).send({}).expect(403);
    await request(app.getHttpServer())
      .post(`/api/admin/cycles/${result.id}/delete`)
      .set('X-Requested-With', 'Aristoteles')
      .send({})
      .expect(401);
    await post(`/${result.id}/delete`).send({}).expect(201);
    expect(
      await prisma.academicCycle.findUnique({ where: { id: result.id } }),
    ).toBeNull();
    expect(
      await prisma.cycleGroup.count({ where: { academicCycleId: result.id } }),
    ).toBe(0);
    expect(
      await prisma.group.findUnique({ where: { id: reusableId } }),
    ).not.toBeNull();
    expect(
      await prisma.enrollmentFee.findUnique({ where: { id: feeId } }),
    ).not.toBeNull();
    await post(`/${result.id}/delete`).send({}).expect(404);
  });
  it('preserves cycles with enrollments and payments when deletion is attempted', async () => {
    await post(`/${cycleId}/delete`).send({}).expect(409);
    const enrolled = await prisma.enrollment.findFirstOrThrow({
      where: { academicCycleId: cycleId },
    });
    const payment = await prisma.payment.create({
      data: {
        enrollmentId: enrolled.id,
        amount: '10',
        paymentDate: new Date('2026-01-01'),
        paymentMethod: 'CASH',
      },
    });
    const groupCount = await prisma.cycleGroup.count({
      where: { academicCycleId: cycleId },
    });
    await post(`/${cycleId}/delete`).send({}).expect(409);
    expect(
      await prisma.payment.findUnique({ where: { id: payment.id } }),
    ).not.toBeNull();
    expect(
      await prisma.enrollment.findUnique({ where: { id: enrolled.id } }),
    ).not.toBeNull();
    expect(
      await prisma.cycleGroup.count({ where: { academicCycleId: cycleId } }),
    ).toBe(groupCount);
  });
});
