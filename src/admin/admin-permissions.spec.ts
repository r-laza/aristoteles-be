import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  AdminPeopleController,
  AdminPeopleService,
  AdminUsersController,
  AdminUsersService,
} from './admin.module';
import { PrismaService } from '../database/prisma.service';
import { AuthService } from '../auth/auth.service';
import { AuthController } from '../auth/auth.controller';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { publicUserSelect } from '../auth/auth.types';
import { hashPassword } from '../auth/password';
import { configureApp } from '../configure-app';
import { AdminDashboardController } from '../dashboard/admin-dashboard.controller';
import { DashboardService } from '../dashboard/dashboard.service';

describe('Administrator permissions (HTTP, isolated database boundary)', () => {
  let app: INestApplication<App>;
  let users: User[];
  let passwordHash: string;
  const publicRecord = (user: User) => {
    const { passwordHash: omitted, ...record } = user;
    void omitted;
    return record;
  };
  const userStore = {
    findUnique: jest.fn(
      (args: { where: { id: number }; select?: typeof publicUserSelect }) => {
        const user = users.find((item) => item.id === args.where.id);
        return user ? (args.select ? publicRecord(user) : user) : null;
      },
    ),
    findUniqueOrThrow: jest.fn((args: { where: { id: number } }) => {
      const user = users.find((item) => item.id === args.where.id);
      if (!user) throw new Error('User missing in fixture');
      return user;
    }),
    findMany: jest.fn(() => users.map(publicRecord)),
    count: jest.fn(
      (args: { where: { id: { not: number } } }) =>
        users.filter(
          (user) =>
            user.id !== args.where.id.not &&
            user.role === 'ADMIN' &&
            user.adminLevel === 'MAIN' &&
            user.isActive,
        ).length,
    ),
    create: jest.fn((args: { data: Partial<User> }) => {
      const user: User = {
        id: Math.max(...users.map((item) => item.id)) + 1,
        username: 'created',
        fullName: 'Created',
        role: 'ADMIN',
        adminLevel: 'REGULAR',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        passwordHash,
        ...args.data,
      };
      users.push(user);
      return publicRecord(user);
    }),
    update: jest.fn((args: { where: { id: number }; data: Partial<User> }) => {
      const user = users.find((item) => item.id === args.where.id);
      if (!user) throw new Error('User missing in fixture');
      Object.assign(user, args.data);
      return publicRecord(user);
    }),
  };
  const tx = { user: userStore, $executeRaw: jest.fn().mockResolvedValue(0) };
  const prisma = {
    ...tx,
    student: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    $transaction: jest.fn(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    ),
  };
  const post = (path: string, token = 'regular') =>
    request(app.getHttpServer())
      .post(`/api${path}`)
      .set('X-Requested-With', 'Aristoteles')
      .set('Cookie', `aristoteles_session=${token}`);
  const edit = {
    fullName: 'Updated',
    username: 'updated',
    isActive: true,
    password: 'ChangedPassword',
  };

  beforeAll(async () => {
    passwordHash = await hashPassword('CurrentPassword');
    const module = await Test.createTestingModule({
      controllers: [
        AdminPeopleController,
        AdminUsersController,
        AuthController,
        AdminDashboardController,
      ],
      providers: [
        AdminPeopleService,
        AdminUsersService,
        AuthService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: DashboardService,
          useValue: { getAdminDashboard: () => ({ dashboard: null }) },
        },
        {
          provide: JwtService,
          useValue: {
            verifyAsync: (token: string) => {
              const id = { main: 1, regular: 2, teacher: 3 }[token];
              if (!id) throw new Error('Invalid token');
              return Promise.resolve({ sub: id });
            },
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    const reflector = new Reflector();
    app.useGlobalGuards(
      new AuthGuard(reflector, module.get(AuthService)),
      new RolesGuard(reflector),
    );
    configureApp(app);
    await app.init();
  });
  beforeEach(() => {
    const identities: Pick<User, 'id' | 'username' | 'role' | 'adminLevel'>[] =
      [
        { id: 1, username: 'main', role: 'ADMIN', adminLevel: 'MAIN' },
        { id: 2, username: 'regular', role: 'ADMIN', adminLevel: 'REGULAR' },
        { id: 3, username: 'teacher', role: 'TEACHER', adminLevel: 'REGULAR' },
      ];
    users = identities.map((user) => ({
      ...user,
      fullName: user.username,
      isActive: true,
      passwordHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    jest.clearAllMocks();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('allows regular administrators to read lists and the dashboard, but not anonymous or teacher requests', async () => {
    for (const path of ['/admin/people', '/admin/users', '/admin/dashboard']) {
      await request(app.getHttpServer())
        .get(`/api${path}`)
        .set('Cookie', 'aristoteles_session=regular')
        .expect(200);
      await request(app.getHttpServer()).get(`/api${path}`).expect(401);
      await request(app.getHttpServer())
        .get(`/api${path}`)
        .set('Cookie', 'aristoteles_session=teacher')
        .expect(403);
    }
  });

  it('forbids administrator creation through both API paths, including a forged Main level', async () => {
    for (const path of ['/admin/people', '/admin/users']) {
      await post(path)
        .send({ ...edit, role: 'ADMIN', adminLevel: 'MAIN' })
        .expect(403);
    }
    expect(userStore.create).not.toHaveBeenCalled();
  });

  it('forbids editing, deactivating, resetting passwords or changing roles/levels of any administrator, including self', async () => {
    for (const id of [1, 2]) {
      for (const change of [
        {},
        { isActive: false },
        { role: 'TEACHER' },
        { adminLevel: 'MAIN' },
      ]) {
        await post(`/admin/people/users/${id}`)
          .send({ ...edit, ...change })
          .expect(403);
      }
    }
    expect(userStore.update).not.toHaveBeenCalled();
  });

  it('preserves regular administrator management of teachers and blocks promotion to administrator', async () => {
    await post('/admin/people/users/3')
      .send({ ...edit, role: 'ADMIN' })
      .expect(403);
    await post('/admin/people/users/3').send(edit).expect(201);
    expect(users[2].fullName).toBe('Updated');
    expect(users[2].role).toBe('TEACHER');
  });

  it('defaults newly created administrators to Regular and allows Main administrators to promote them', async () => {
    await post('/admin/people', 'main')
      .send({ ...edit, role: 'ADMIN' })
      .expect(201);
    expect(users[3].adminLevel).toBe('REGULAR');
    await post('/admin/people/users/4', 'main')
      .send({ ...edit, adminLevel: 'MAIN' })
      .expect(201);
    expect(users[3].adminLevel).toBe('MAIN');
    await post('/admin/people/users/1', 'main')
      .send({ ...edit, isActive: false })
      .expect(201);
    expect(
      users.filter((user) => user.isActive && user.adminLevel === 'MAIN'),
    ).toHaveLength(1);
  });

  it('rejects deactivation, demotion or role changes that remove the last active Main Administrator', async () => {
    for (const change of [
      { isActive: false },
      { adminLevel: 'REGULAR' },
      { role: 'TEACHER' },
    ]) {
      const response = await post('/admin/people/users/1', 'main')
        .send({ ...edit, ...change })
        .expect(409);
      expect(response.body).toMatchObject({ code: 'LAST_MAIN_ADMINISTRATOR' });
    }
    expect(userStore.update).not.toHaveBeenCalled();
    expect(tx.$executeRaw).toHaveBeenCalled();
  });

  it('allows self-profile edits after password verification without changing permissions', async () => {
    await post('/auth/profile')
      .send({
        fullName: 'My Profile',
        username: 'mine',
        password: 'NewPassword',
        currentPassword: 'CurrentPassword',
      })
      .expect(201);
    expect(users[1]).toMatchObject({
      fullName: 'My Profile',
      username: 'mine',
      role: 'ADMIN',
      adminLevel: 'REGULAR',
      isActive: true,
    });
    expect(users[1].passwordHash).not.toBe(passwordHash);
    await post('/auth/profile')
      .send({
        fullName: 'Not Saved',
        username: 'another',
        currentPassword: 'wrong',
      })
      .expect(400);
    expect(users[1].fullName).toBe('My Profile');
  });

  it('rejects privilege and target-ID fields on the self-profile API', async () => {
    for (const field of [
      'role',
      'adminLevel',
      'isActive',
      'id',
      'userId',
      'passwordHash',
    ]) {
      await post('/auth/profile')
        .send({
          fullName: 'Attempt',
          username: 'regular',
          [field]: field === 'isActive' ? false : 'MAIN',
        })
        .expect(403);
    }
    expect(userStore.update).not.toHaveBeenCalled();
  });
  it('allows name-only profile updates without requiring a password or changing credentials', async () => {
    await post('/auth/profile')
      .send({ fullName: 'My Display Name', username: 'regular' })
      .expect(201);
    expect(users[1]).toMatchObject({
      fullName: 'My Display Name',
      username: 'regular',
      passwordHash,
      adminLevel: 'REGULAR',
      isActive: true,
    });
  });
  it('rechecks current permission levels for an existing session after demotion', async () => {
    users[0].adminLevel = 'REGULAR';
    users[1].adminLevel = 'MAIN';
    await post('/admin/people', 'main')
      .send({ ...edit, role: 'ADMIN' })
      .expect(403);
    expect(userStore.create).not.toHaveBeenCalled();
  });
  it('cannot modify administrator accounts through a linked student access endpoint', async () => {
    prisma.student.findUnique.mockResolvedValueOnce({ id: 55, user: users[0] });
    await post('/admin/people/students/55/access').send(edit).expect(403);
    expect(userStore.update).not.toHaveBeenCalled();
  });
});
