import { PreuniversityDueRule, Prisma } from '@prisma/client';

export function preuniversitySchedule(
  total: Prisma.Decimal,
  installments: number,
  dueRule: PreuniversityDueRule,
  startDate: Date,
) {
  if (!Number.isInteger(installments) || installments < 1 || installments > 3)
    throw new Error('Invalid installment count');
  const totalCents = BigInt(total.mul(100).toFixed(0));
  if (totalCents <= 0n) throw new Error('Invalid total');
  const count = BigInt(installments);
  const quotient = totalCents / count;
  const remainder = totalCents % count;
  let year = startDate.getUTCFullYear();
  let month = startDate.getUTCMonth();
  if (
    dueRule === PreuniversityDueRule.FIFTEENTH &&
    startDate.getUTCDate() > 15
  ) {
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return Array.from({ length: installments }, (_, index) => {
    const cursor = new Date(Date.UTC(year, month + index, 1));
    const dueDay =
      dueRule === PreuniversityDueRule.FIFTEENTH
        ? 15
        : new Date(
            Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0),
          ).getUTCDate();
    const cents = quotient + (BigInt(index) < remainder ? 1n : 0n);
    return {
      number: index + 1,
      period: cursor.toISOString().slice(0, 7),
      amount: new Prisma.Decimal(cents.toString()).div(100),
      dueDate: new Date(
        Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), dueDay),
      ),
    };
  });
}
