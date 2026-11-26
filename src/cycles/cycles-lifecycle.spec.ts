import { AcademicCycleStatus } from '@prisma/client';
import { CyclesService } from './cycles.service';

describe('Academic cycle lifecycle', () => {
  function service(status: AcademicCycleStatus) {
    const update = jest.fn().mockResolvedValue({ id: 4, status: AcademicCycleStatus.ACTIVE });
    const transaction = jest.fn(async (callback) => callback({
      $queryRaw: jest.fn().mockResolvedValue([{ status }]),
      academicCycle: { update },
    }));
    return { cycles: new CyclesService({ $transaction: transaction } as never), update };
  }

  it('activates an upcoming cycle atomically', async () => {
    const { cycles, update } = service(AcademicCycleStatus.UPCOMING);
    await cycles.transition(4, AcademicCycleStatus.ACTIVE);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 4 }, data: { status: AcademicCycleStatus.ACTIVE },
    }));
  });

  it('closes an active cycle', async () => {
    const { cycles, update } = service(AcademicCycleStatus.ACTIVE);
    await cycles.transition(4, AcademicCycleStatus.CLOSED);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: AcademicCycleStatus.CLOSED },
    }));
  });

  it.each([
    [AcademicCycleStatus.ACTIVE, AcademicCycleStatus.ACTIVE],
    [AcademicCycleStatus.CLOSED, AcademicCycleStatus.ACTIVE],
    [AcademicCycleStatus.CLOSED, AcademicCycleStatus.CLOSED],
    [AcademicCycleStatus.UPCOMING, AcademicCycleStatus.CLOSED],
  ])('rejects irreversible transition from %s to %s', async (from, to) => {
    const { cycles, update } = service(from);
    await expect(cycles.transition(4, to)).rejects.toMatchObject({ status: 409 });
    expect(update).not.toHaveBeenCalled();
  });
});
