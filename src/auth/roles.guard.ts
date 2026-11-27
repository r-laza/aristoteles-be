import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminLevel, Role } from '@prisma/client';
import { AuthRequest } from './auth.types';

export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);
export const AdminLevels = (...levels: AdminLevel[]) =>
  SetMetadata('adminLevels', levels);
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext) {
    const roles = this.reflector.getAllAndOverride<Role[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);
    const adminLevels = this.reflector.getAllAndOverride<AdminLevel[]>(
      'adminLevels',
      [context.getHandler(), context.getClass()],
    );
    const user = context.switchToHttp().getRequest<AuthRequest>().user;
    return (
      (!roles || roles.includes(user.role)) &&
      (!adminLevels ||
        (user.adminLevel !== null && adminLevels.includes(user.adminLevel)))
    );
  }
}
