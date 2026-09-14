import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../database/prisma.service';
import { hashPassword, verifyPassword } from './password';
import { publicUserSelect } from './auth.types';
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
}
