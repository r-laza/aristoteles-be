import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service';
import { AUTH_COOKIE, AuthRequest } from './auth.types';

export const Public = () => SetMetadata('public', true);
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}
  async canActivate(context: ExecutionContext) {
    if (
      this.reflector.getAllAndOverride<boolean>('public', [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const token: unknown = request.cookies?.[AUTH_COOKIE];
    if (typeof token !== 'string') throw new UnauthorizedException();
    request.user = await this.auth.authenticate(token);
    return true;
  }
}
