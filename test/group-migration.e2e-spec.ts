import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

describe('Reusable groups data migration (PostgreSQL)', () => {
  const schema = `migration_test_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set('schema', schema);
  const prisma = new PrismaClient({
    datasources: { db: { url: url.toString() } },
  });
  const migrations = join(__dirname, '../prisma/migrations');
  const target = '20260915000000_reusable_groups_fees';
  async function migrate(directory: string) {
    const sql = readFileSync(
      join(migrations, directory, 'migration.sql'),
      'utf8',
    );
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s && s !== 'BEGIN' && s !== 'COMMIT');
    await prisma.$transaction(
      statements.map((statement) => prisma.$executeRawUnsafe(statement)),
    );
  }
  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    for (const migration of readdirSync(migrations)
      .filter((name) => name < target)
      .sort()) {
      await migrate(migration);
    }
  });
  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await prisma.$disconnect();
  });
  it('merges reusable names and preserves assignments, historical prices and payments', async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AcademicCycle" ("name", "startDate", "endDate", "baseEnrollmentAmount", "updatedAt") VALUES ('2026-A', '2026-01-01', '2026-06-30', 600, NOW()), ('2026-B', '2026-07-01', '2026-12-31', 450, NOW())`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Group" ("name", "academicCycleId", "updatedAt") VALUES ('Alfas', 1, NOW()), ('Alfas', 2, NOW()), ('Betas', 2, NOW())`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "User" ("username", "passwordHash", "fullName", "role", "updatedAt") VALUES ('migration-student', 'unused', 'Migration student', 'STUDENT', NOW())`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AcademicEnrollment" ("studentId", "academicCycleId", "groupId", "baseAmount", "discountAmount", "finalAmount", "updatedAt") VALUES (1, 1, 1, 550, 50, 500, NOW()), (1, 2, 2, 450, 0, 450, NOW())`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Payment" ("enrollmentId", "amount", "paymentDate", "paymentMethod") VALUES (1, 100, '2026-03-01', 'CASH')`,
    );
    await migrate(target);
    await migrate('20260916000000_reusable_fees');
    expect(await prisma.group.count()).toBe(2);
    expect(await prisma.cycleGroup.count()).toBe(3);
    const assignments = await prisma.cycleGroup.findMany({
      where: { reusableGroup: { name: 'Alfas' } },
    });
    expect(assignments).toHaveLength(2);
    expect(assignments[0].reusableGroupId).toBe(assignments[1].reusableGroupId);
    const enrollments = await prisma.enrollment.findMany({
      orderBy: { id: 'asc' },
      include: { fee: true, payments: true },
    });
    expect(enrollments.map((e) => e.baseAmount.toString())).toEqual([
      '550',
      '450',
    ]);
    expect(enrollments.map((e) => e.finalAmount.toString())).toEqual([
      '500',
      '450',
    ]);
    expect(enrollments.map((e) => e.fee.amount.toString())).toEqual([
      '550',
      '450',
    ]);
    expect(enrollments[0].payments[0].amount.toString()).toBe('100');
    expect(enrollments[0].payments[0].enrollmentId).toBe(enrollments[0].id);
    expect(await prisma.enrollmentFee.count()).toBe(4);
    const fees = await prisma.enrollmentFee.findMany({
      include: { cycleGroups: true },
    });
    expect(fees.every((fee) => fee.cycleGroups.length === 1)).toBe(true);
    await prisma.cycleGroup.update({
      where: { id: 3 },
      data: { fees: { connect: { id: fees[0].id } } },
    });
    expect(await prisma.enrollmentFee.count()).toBe(4);
    expect(
      (
        await prisma.enrollmentFee.findUniqueOrThrow({
          where: { id: fees[0].id },
          include: { cycleGroups: true },
        })
      ).cycleGroups,
    ).toHaveLength(2);
  });
});
