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

describe('Authentication and role authorization (PostgreSQL)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const prefix = `auth-test-${randomUUID()}`;
  const password = 'test-password-2026';
  let adminCookie: string[];
  let studentCookie: string[];
  let teacherCookie: string[];
  const post = (path: string) =>
    request(app.getHttpServer())
      .post(`/api${path}`)
      .set('X-Requested-With', 'Aristoteles');
  const get = (path: string) => request(app.getHttpServer()).get(`/api${path}`);

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.user.create({
      data: {
        username: `${prefix}-admin`,
        fullName: 'Test Admin',
        role: 'ADMIN',
        passwordHash: await hashPassword(password),
      },
    });
  });
  afterAll(async () => {
    if (prisma)
      await prisma.user.deleteMany({
        where: { username: { startsWith: prefix } },
      });
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
  });
  it('blocks anonymous requests and cross-site writes', async () => {
    await get('/auth/me').expect(401);
    await get('/admin/users').expect(401);
    await get('/dashboard').expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({})
      .expect(403);
  });
  it('rejects invalid credentials and selected role mismatch', async () => {
    for (const input of [
      { username: `${prefix}-admin`, password: 'wrong', role: 'ADMIN' },
      { username: `${prefix}-admin`, password, role: 'STUDENT' },
      { username: `${prefix}-missing`, password, role: 'ADMIN' },
    ])
      await post('/auth/login').send(input).expect(401);
    await post('/auth/login')
      .send({ username: [], password, role: 'OWNER' })
      .expect(400);
  });
  it('logs in with an HTTP-only cookie and restores a safe user', async () => {
    const login = await post('/auth/login')
      .send({ username: `${prefix}-admin`, password, role: 'ADMIN' })
      .expect(200);
    adminCookie = login.headers['set-cookie'] as unknown as string[];
    expect(adminCookie[0]).toContain('HttpOnly');
    expect(adminCookie[0]).toContain('SameSite=Strict');
    expect(
      (login.body as Record<string, unknown>).passwordHash,
    ).toBeUndefined();
    const me = await get('/auth/me').set('Cookie', adminCookie).expect(200);
    expect((me.body as Record<string, unknown>).role).toBe('ADMIN');
    expect((me.body as Record<string, unknown>).passwordHash).toBeUndefined();
    await get('/dashboard').set('Cookie', adminCookie).expect(403);
  });
  it('allows only admins to create valid users and hashes their passwords', async () => {
    for (const role of ['STUDENT', 'TEACHER']) {
      const username = `${prefix}-${role}`;
      const created = await post('/admin/users')
        .set('Cookie', adminCookie)
        .send({ username, password, fullName: `Test ${role}`, role })
        .expect(201);
      expect(
        (created.body as Record<string, unknown>).passwordHash,
      ).toBeUndefined();
      const stored = await prisma.user.findUniqueOrThrow({
        where: { username },
      });
      expect(stored.passwordHash).toMatch(/^scrypt\$/);
      expect(stored.passwordHash).not.toContain(password);
      await post('/admin/users')
        .set('Cookie', adminCookie)
        .send({ username, password, fullName: 'Duplicate', role })
        .expect(409);
      const login = await post('/auth/login')
        .send({ username, password, role })
        .expect(200);
      const cookie = login.headers['set-cookie'] as unknown as string[];
      if (role === 'STUDENT') studentCookie = cookie;
      else teacherCookie = cookie;
    }
    await post('/admin/users')
      .set('Cookie', adminCookie)
      .send({ username: ' ', password, fullName: ' ', role: 'ADMIN' })
      .expect(400);
    const listed = await get('/admin/users')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(
      (listed.body as Record<string, unknown>[]).every(
        (user: Record<string, unknown>) => !('passwordHash' in user),
      ),
    ).toBe(true);
  });
  it('denies student/teacher admin APIs, preserves the student dashboard', async () => {
    for (const cookie of [studentCookie, teacherCookie]) {
      await get('/admin/users').set('Cookie', cookie).expect(403);
      await post('/admin/users').set('Cookie', cookie).send({}).expect(403);
      await get('/auth/me').set('Cookie', cookie).expect(200);
    }
    await get('/dashboard').set('Cookie', studentCookie).expect(200);
    await get('/dashboard').set('Cookie', teacherCookie).expect(403);
  });
  it('checks current database role and active status on every request', async () => {
    await prisma.user.update({
      where: { username: `${prefix}-admin` },
      data: { role: 'TEACHER' },
    });
    await get('/admin/users').set('Cookie', adminCookie).expect(403);
    await prisma.user.update({
      where: { username: `${prefix}-STUDENT` },
      data: { isActive: false },
    });
    await get('/auth/me').set('Cookie', studentCookie).expect(401);
    await post('/auth/login')
      .send({ username: `${prefix}-STUDENT`, password, role: 'STUDENT' })
      .expect(401);
  });
  it('rejects forged cookies and clears the session cookie on logout', async () => {
    await get('/auth/me')
      .set('Cookie', 'aristoteles_session=forged')
      .expect(401);
    const logout = await post('/auth/logout')
      .set('Cookie', teacherCookie)
      .send({})
      .expect(204);
    expect(logout.headers['set-cookie'][0]).toContain('aristoteles_session=;');
    await get('/auth/me').expect(401);
  });
});
