import { Prisma } from '@prisma/client';
import type { Request } from 'express';

export const publicUserSelect = {
  id: true,
  username: true,
  fullName: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;
export type PublicUser = Prisma.UserGetPayload<{
  select: typeof publicUserSelect;
}>;
export type AuthRequest = Request & { user: PublicUser };
export const AUTH_COOKIE = 'aristoteles_session';
export const SESSION_SECONDS = 60 * 60 * 8;
