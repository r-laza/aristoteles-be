import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { AuthRequest } from './auth.types';

export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext) {
    const roles = this.reflector.getAllAndOverride<Role[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);
    return (
      !roles ||
      roles.includes(
        context.switchToHttp().getRequest<AuthRequest>().user?.role,
      )
    );
  }
}
