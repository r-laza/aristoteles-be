import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';

export function validateCredentials(body: unknown, create = false) {
  if (!body || typeof body !== 'object') throw new BadRequestException();
  const { username, password, role, fullName } = body as Record<
    string,
    unknown
  >;
  if (
    typeof username !== 'string' ||
    !username.trim() ||
    username.trim().length > 100 ||
    typeof password !== 'string' ||
    !password.trim() ||
    password.length > 256 ||
    typeof role !== 'string' ||
    !Object.values(Role).includes(role as Role) ||
    (create &&
      (typeof fullName !== 'string' ||
        !fullName.trim() ||
        fullName.trim().length > 200))
  ) {
    throw new BadRequestException('Invalid user fields');
  }
  return {
    username: username.trim(),
    password,
    role: role as Role,
    fullName: typeof fullName === 'string' ? fullName.trim() : '',
  };
}
