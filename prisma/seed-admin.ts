import { Prisma, PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/auth/password';

const prisma = new PrismaClient();

function getInitialPassword(): string {
  const password = process.env.ADMIN_INITIAL_PASSWORD;

  if (!password) {
    throw new Error('ADMIN_INITIAL_PASSWORD is required');
  }

  const isStrong =
    password.length >= 12 &&
    password.length <= 256 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password);

  if (!isStrong) {
    throw new Error(
      'ADMIN_INITIAL_PASSWORD must be 12-256 characters and include uppercase, lowercase, number, and special characters',
    );
  }

  return password;
}

async function main() {
  const password = getInitialPassword();
  const existingAdmin = await prisma.user.findUnique({
    where: { username: 'admin' },
    select: { id: true },
  });

  if (existingAdmin) {
    console.log('Admin user already exists; no changes were made.');
    return;
  }

  try {
    await prisma.user.create({
      data: {
        username: 'admin',
        passwordHash: await hashPassword(password),
        fullName: 'Administrador',
        role: 'ADMIN',
        adminLevel: 'MAIN',
        isActive: true,
      },
    });
    console.log('Admin user created.');
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      console.log('Admin user already exists; no changes were made.');
      return;
    }
    throw error;
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Admin seed failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
