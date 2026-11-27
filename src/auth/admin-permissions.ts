import { ForbiddenException } from '@nestjs/common';
import type { PublicUser } from './auth.types';

export function canManageAdministrators(user: PublicUser) {
  return user.isActive && user.role === 'ADMIN' && user.adminLevel === 'MAIN';
}

export function assertCanManageAdministrators(user: PublicUser) {
  if (!canManageAdministrators(user))
    throw new ForbiddenException({ code: 'ADMIN_MANAGEMENT_FORBIDDEN' });
}
