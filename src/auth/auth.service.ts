import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../database/prisma.service';
import { hashPassword, verifyPassword } from './password';
import { publicUserSelect, type PublicUser } from './auth.types';
import { validateCredentials } from './validation';

@Injectable()
export class AuthService {
  private readonly dummyHash = hashPassword('unused-password-for-timing');
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(body: unknown) {
    const input = validateCredentials(body);
    const user = await this.prisma.user.findUnique({
      where: { username: input.username },
    });
    const valid = await verifyPassword(
      input.password,
      user?.passwordHash ?? (await this.dummyHash),
    );
    if (!user || !valid || !user.isActive || user.role !== input.role) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const token = await this.jwt.signAsync({ sub: user.id });
    return {
      token,
      user: await this.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: publicUserSelect,
      }),
    };
  }

  async authenticate(token: string) {
    try {
      const payload = await this.jwt.verifyAsync<{ sub: number }>(token);
      if (!Number.isInteger(payload.sub)) throw new Error();
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: publicUserSelect,
      });
      if (!user?.isActive) throw new Error();
      return user;
    } catch {
      throw new UnauthorizedException();
    }
  }

  async updateProfile(actor: PublicUser, body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new BadRequestException({ code: 'PROFILE_INVALID' });
    const input = body as Record<string, unknown>;
    if (
      Object.keys(input).some(
        (key) =>
          !['fullName', 'username', 'password', 'currentPassword'].includes(
            key,
          ),
      )
    )
      throw new ForbiddenException({ code: 'PROFILE_PRIVILEGED_FIELDS' });
    const password =
      input.password === undefined || input.password === ''
        ? undefined
        : input.password;
    const { username, fullName } = validateCredentials(
      {
        ...input,
        role: actor.role,
        password: password ?? 'unchanged',
      },
      true,
    );
    const current = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
    });
    if (password !== undefined || username !== current.username) {
      if (
        typeof input.currentPassword !== 'string' ||
        input.currentPassword.length > 256 ||
        !(await verifyPassword(input.currentPassword, current.passwordHash))
      )
        throw new BadRequestException({ code: 'PROFILE_PASSWORD_INVALID' });
    }
    try {
      return await this.prisma.user.update({
        where: { id: actor.id },
        data: {
          username,
          fullName,
          ...(typeof password === 'string'
            ? { passwordHash: await hashPassword(password) }
            : {}),
        },
        select: publicUserSelect,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException({ code: 'PROFILE_USERNAME_DUPLICATE' });
      throw error;
    }
  }
}
