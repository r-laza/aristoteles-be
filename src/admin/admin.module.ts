import {
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Module,
  Post,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { Roles } from '../auth/roles.guard';
import { publicUserSelect } from '../auth/auth.types';
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
  async create(body: unknown) {
    const { password, ...data } = validateCredentials(body, true);
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
@Controller('admin/users')
@Roles('ADMIN')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}
  @Get()
  list() {
    return this.users.list();
  }
  @Post()
  create(@Body() body: unknown) {
    return this.users.create(body);
  }
}
@Module({ controllers: [AdminUsersController], providers: [AdminUsersService] })
export class AdminModule {}
