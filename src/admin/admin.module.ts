import {
  BadRequestException,
  Body,
  ConflictException,
  ForbiddenException,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import {
  Gender,
  AdminLevel,
  Prisma,
  ReceiptDocumentType,
  Relationship,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { Roles } from '../auth/roles.guard';
import {
  publicUserSelect,
  type AuthRequest,
  type PublicUser,
} from '../auth/auth.types';
import { assertCanManageAdministrators } from '../auth/admin-permissions';
import { validateCredentials } from '../auth/validation';
import { hashPassword } from '../auth/password';

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}
  list() {
    return this.prisma.user.findMany({
      select: publicUserSelect,
      orderBy: { createdAt: 'desc' },
    });
  }
  async create(body: unknown, actor: PublicUser) {
    const { password, ...data } = validateCredentials(body, true);
    const input = object(body);
    if (data.role === 'ADMIN') {
      return this.prisma
        .$transaction(async (tx) => {
          await authorizeAdministratorWrite(tx, actor);
          return tx.user.create({
            data: {
              ...data,
              adminLevel: administratorLevel(input),
              passwordHash: await hashPassword(password),
            },
            select: publicUserSelect,
          });
        })
        .catch((error: unknown) => {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          )
            throw new ConflictException('Username already exists');
          throw error;
        });
    }
    if (input.adminLevel !== undefined)
      throw new BadRequestException(
        'Administrator level requires administrator role',
      );
    try {
      return await this.prisma.user.create({
        data: { ...data, passwordHash: await hashPassword(password) },
        select: publicUserSelect,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Username already exists');
      }
      throw error;
    }
  }
}

function object(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new BadRequestException({ code: 'VALIDATION_ERROR' });
  return body as Record<string, unknown>;
}

function administratorLevel(
  input: Record<string, unknown>,
  fallback: AdminLevel = AdminLevel.REGULAR,
) {
  const level = input.adminLevel ?? fallback;
  if (level !== AdminLevel.MAIN && level !== AdminLevel.REGULAR)
    throw new BadRequestException('Invalid administrator level');
  return level;
}

async function authorizeAdministratorWrite(
  tx: Prisma.TransactionClient,
  actor: PublicUser,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(849217001)`;
  const currentActor = await tx.user.findUnique({
    where: { id: actor.id },
    select: publicUserSelect,
  });
  if (!currentActor) throw new NotFoundException();
  assertCanManageAdministrators(currentActor);
}

function invalid(
  field: string,
  reason: 'required' | 'tooLong' | 'format',
): never {
  throw new BadRequestException({ code: 'VALIDATION_ERROR', field, reason });
}

function text(input: Record<string, unknown>, key: string, max = 200): string {
  const value = input[key];
  if (typeof value !== 'string' || !value.trim()) invalid(key, 'required');
  if (value.trim().length > max) invalid(key, 'tooLong');
  return value.trim();
}

function optionalText(
  input: Record<string, unknown>,
  key: string,
  max = 200,
): string | null {
  const value = input[key];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') invalid(key, 'format');
  if (value.trim().length > max) invalid(key, 'tooLong');
  return value.trim();
}

function dateOnly(value: unknown, field: string): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    invalid(field, 'format');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    invalid(field, 'format');
  return date;
}

@Injectable()
export class AdminPeopleService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const [students, staff] = await Promise.all([
      this.prisma.student.findMany({
        include: { user: { select: publicUserSelect } },
      }),
      this.prisma.user.findMany({
        where: { role: { in: ['ADMIN', 'TEACHER'] } },
        select: publicUserSelect,
      }),
    ]);
    return [
      ...students.map((student) => this.studentPerson(student)),
      ...staff.map((user) => ({
        ...user,
        kind: 'USER' as const,
      })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async create(body: unknown, actor: PublicUser) {
    const input = object(body);
    const role = input.role;
    if (role !== 'ADMIN' && input.adminLevel !== undefined)
      throw new BadRequestException(
        'Administrator level requires administrator role',
      );
    if (role === 'STUDENT') return this.createStudent(input);
    if (role !== 'TEACHER' && role !== 'ADMIN')
      throw new BadRequestException('Invalid role');
    if (input.isActive !== undefined && typeof input.isActive !== 'boolean')
      throw new BadRequestException('Invalid status');
    const credentials = validateCredentials({ ...input, role }, true);
    const { password, ...userData } = credentials;
    return this.withConflict(async () => {
      const create = async (client: Prisma.TransactionClient) =>
        client.user.create({
          data: {
            ...userData,
            passwordHash: await hashPassword(password),
            role,
            ...(role === 'ADMIN'
              ? { adminLevel: administratorLevel(input) }
              : {}),
            isActive:
              input.isActive === undefined ? true : input.isActive === true,
          },
          select: publicUserSelect,
        });
      if (role !== 'ADMIN' && input.adminLevel !== undefined)
        throw new BadRequestException(
          'Administrator level requires administrator role',
        );
      const user =
        role === 'ADMIN'
          ? await this.prisma.$transaction(async (tx) => {
              await authorizeAdministratorWrite(tx, actor);
              return create(tx);
            })
          : await create(this.prisma);
      return { ...user, kind: 'USER' as const };
    });
  }

  async updateStudent(studentId: number, body: unknown) {
    const input = object(body);
    const data = this.studentData(input);
    return this.withConflict(async () => {
      const current = await this.prisma.student.findUnique({
        where: { id: studentId },
      });
      if (!current) throw new NotFoundException();
      const student = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.student.update({
          where: { id: studentId },
          data,
          include: { user: { select: publicUserSelect } },
        });
        if (updated.userId) {
          if (updated.user?.role === 'ADMIN')
            throw new ForbiddenException({
              code: 'ADMIN_ACCOUNT_WRONG_ENDPOINT',
            });
          await tx.user.update({
            where: { id: updated.userId },
            data: { fullName: updated.fullName },
          });
        }
        return updated;
      });
      return this.studentPerson(student);
    });
  }

  async updateUser(userId: number, body: unknown, actor: PublicUser) {
    const input = object(body);
    if (typeof input.isActive !== 'boolean')
      throw new BadRequestException('Invalid status');
    const isActive = input.isActive;
    const fullName = text(input, 'fullName');
    const username = text(input, 'username', 100);
    const password = optionalText(input, 'password', 256);
    return this.withConflict(async () => {
      const user = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(849217001)`;
        const current = await tx.user.findUnique({ where: { id: userId } });
        if (!current || current.role === 'STUDENT')
          throw new NotFoundException();
        const role = input.role ?? current.role;
        if (role !== 'ADMIN' && role !== 'TEACHER')
          throw new BadRequestException('Invalid role');
        if (
          role !== 'ADMIN' &&
          input.adminLevel !== undefined &&
          input.adminLevel !== AdminLevel.REGULAR
        )
          throw new BadRequestException(
            'Administrator level requires administrator role',
          );
        if (
          current.role === 'ADMIN' ||
          role === 'ADMIN' ||
          input.adminLevel !== undefined
        )
          await authorizeAdministratorWrite(tx, actor);
        const adminLevel =
          role === 'ADMIN'
            ? administratorLevel(input, current.adminLevel)
            : AdminLevel.REGULAR;
        if (
          current.role === 'ADMIN' &&
          current.adminLevel === AdminLevel.MAIN &&
          current.isActive &&
          (role !== 'ADMIN' || adminLevel !== AdminLevel.MAIN || !isActive)
        ) {
          const remaining = await tx.user.count({
            where: {
              role: 'ADMIN',
              adminLevel: AdminLevel.MAIN,
              isActive: true,
              id: { not: userId },
            },
          });
          if (!remaining)
            throw new ConflictException({ code: 'LAST_MAIN_ADMINISTRATOR' });
        }
        return tx.user.update({
          where: { id: userId },
          data: {
            fullName,
            username,
            isActive,
            role,
            adminLevel,
            ...(password ? { passwordHash: await hashPassword(password) } : {}),
          },
          select: publicUserSelect,
        });
      });
      return { ...user, kind: 'USER' as const };
    });
  }

  async manageStudentAccess(studentId: number, body: unknown) {
    const input = object(body);
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: { user: true },
    });
    if (!student) throw new NotFoundException();
    if (student.user?.role === 'ADMIN')
      throw new ForbiddenException({ code: 'ADMIN_ACCOUNT_WRONG_ENDPOINT' });
    if (typeof input.isActive !== 'boolean')
      throw new BadRequestException('Invalid status');
    const isActive = input.isActive;
    const username = text(input, 'username', 100);
    const password = optionalText(input, 'password', 256);
    if (!student.user && !password)
      throw new BadRequestException('Password required');
    return this.withConflict(async () => {
      await this.prisma.$transaction(async (tx) => {
        if (student.user) {
          await tx.user.update({
            where: { id: student.user.id },
            data: {
              username,
              isActive,
              ...(password
                ? { passwordHash: await hashPassword(password) }
                : {}),
            },
          });
        } else {
          const user = await tx.user.create({
            data: {
              username,
              passwordHash: await hashPassword(password!),
              fullName: student.fullName,
              role: 'STUDENT',
              isActive,
            },
          });
          await tx.student.update({
            where: { id: studentId },
            data: { userId: user.id },
          });
        }
      });
      const updated = await this.prisma.student.findUniqueOrThrow({
        where: { id: studentId },
        include: { user: { select: publicUserSelect } },
      });
      return this.studentPerson(updated);
    });
  }

  private async createStudent(input: Record<string, unknown>) {
    const data = this.studentData(input);
    const { firstName, lastName } = data;
    const createAccess = input.createAccess === true;
    let username: string | undefined, password: string | undefined;
    if (createAccess) {
      const credentials = validateCredentials(
        { ...input, fullName: `${firstName} ${lastName}`, role: 'STUDENT' },
        true,
      );
      username = credentials.username;
      password = credentials.password;
    }
    const isActive = data.isActive;
    return this.withConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const user = createAccess
          ? await tx.user.create({
              data: {
                username: username!,
                passwordHash: await hashPassword(password!),
                fullName: `${firstName} ${lastName}`,
                role: 'STUDENT',
                isActive,
              },
            })
          : null;
        const student = await tx.student.create({
          data: {
            ...data,
            userId: user?.id,
          },
          include: { user: { select: publicUserSelect } },
        });
        return this.studentPerson(student);
      }),
    );
  }

  private studentData(input: Record<string, unknown>) {
    const firstName = text(input, 'firstName');
    const lastName = text(input, 'lastName');
    if (typeof input.isActive !== 'boolean') invalid('isActive', 'format');
    const isActive = input.isActive;
    if (!Object.values(Gender).includes(input.gender as Gender))
      invalid('gender', 'format');
    if (
      !Object.values(Relationship).includes(input.relationship as Relationship)
    )
      invalid('relationship', 'format');
    if (
      !Object.values(ReceiptDocumentType).includes(
        input.representativeDocumentType as ReceiptDocumentType,
      )
    )
      invalid('representativeDocumentType', 'format');
    const representativeDocumentType =
      input.representativeDocumentType as ReceiptDocumentType;
    const representativeDocumentNumber = text(
      input,
      'representativeDocumentNumber',
      30,
    );
    const representativeDocumentValid =
      representativeDocumentType === ReceiptDocumentType.DNI
        ? /^\d{8}$/.test(representativeDocumentNumber)
        : /^[A-Za-z0-9]{6,12}$/.test(representativeDocumentNumber);
    if (!representativeDocumentValid)
      invalid('representativeDocumentNumber', 'format');
    return {
      dni: text(input, 'dni', 30),
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`,
      initials: `${firstName[0]}${lastName[0]}`.toUpperCase(),
      birthDate: dateOnly(input.birthDate, 'birthDate'),
      gender: input.gender as Gender,
      representativeName: text(input, 'representativeName'),
      representativeDocumentType,
      representativeDocumentNumber,
      relationship: input.relationship as Relationship,
      relationshipOther:
        input.relationship === 'OTHER'
          ? text(input, 'relationshipOther', 100)
          : null,
      primaryPhone: text(input, 'primaryPhone', 30),
      secondaryPhone: optionalText(input, 'secondaryPhone', 30),
      isActive,
    };
  }

  private studentPerson<
    T extends { user: { username: string; isActive: boolean } | null },
  >(student: T) {
    return {
      ...student,
      kind: 'STUDENT' as const,
      role: 'STUDENT' as const,
      username: student.user?.username ?? null,
      accessIsActive: student.user?.isActive ?? null,
    };
  }

  private async withConflict<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const target = String(error.meta?.target ?? '');
        throw new ConflictException({
          code: 'DUPLICATE',
          field: target.includes('dni')
            ? 'dni'
            : target.includes('username')
              ? 'username'
              : undefined,
        });
      }
      throw error;
    }
  }
}
@Controller('admin/users')
@Roles('ADMIN')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}
  @Get()
  list() {
    return this.users.list();
  }
  @Post()
  create(@Body() body: unknown, @Req() request: AuthRequest) {
    return this.users.create(body, request.user);
  }
}

@Controller('admin/people')
@Roles('ADMIN')
export class AdminPeopleController {
  constructor(private readonly people: AdminPeopleService) {}
  @Get()
  list() {
    return this.people.list();
  }
  @Post()
  create(@Body() body: unknown, @Req() request: AuthRequest) {
    return this.people.create(body, request.user);
  }
  @Post('students/:id')
  updateStudent(@Param('id') id: string, @Body() body: unknown) {
    return this.people.updateStudent(this.id(id), body);
  }
  @Post('students/:id/access')
  manageStudentAccess(@Param('id') id: string, @Body() body: unknown) {
    return this.people.manageStudentAccess(this.id(id), body);
  }
  @Post('users/:id')
  updateUser(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthRequest,
  ) {
    return this.people.updateUser(this.id(id), body, request.user);
  }
  private id(value: string) {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) throw new BadRequestException();
    return id;
  }
}

@Module({
  controllers: [AdminUsersController, AdminPeopleController],
  providers: [AdminUsersService, AdminPeopleService],
})
export class AdminModule {}
