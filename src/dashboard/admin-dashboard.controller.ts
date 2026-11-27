import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { institutionToday } from '../payments/obligations';
import { AdminLevels, Roles } from '../auth/roles.guard';
import { DashboardService } from './dashboard.service';

@Controller('admin/dashboard')
@Roles('ADMIN')
@AdminLevels('MAIN')
export class AdminDashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  getDashboard(
    @Query('branchId', new ParseIntPipe({ optional: true })) branchId?: number,
    @Query('cycleId', new ParseIntPipe({ optional: true })) cycleId?: number,
    @Query('groupId', new ParseIntPipe({ optional: true })) groupId?: number,
  ) {
    return this.dashboardService.getAdminDashboard({
      branchId,
      cycleId,
      groupId,
    });
  }

  @Get('payments')
  payments(
    @Query('branchId', new ParseIntPipe({ optional: true })) branchId?: number,
    @Query('cycleId', new ParseIntPipe({ optional: true })) cycleId?: number,
    @Query('groupId', new ParseIntPipe({ optional: true })) groupId?: number,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('search') search = '',
  ) {
    return this.dashboardService.payments({
      branchId,
      cycleId,
      groupId,
      page,
      search,
    });
  }

  @Get('debtors')
  debtors(
    @Query('branchId', new ParseIntPipe({ optional: true })) branchId?: number,
    @Query('cycleId', new ParseIntPipe({ optional: true })) cycleId?: number,
    @Query('groupId', new ParseIntPipe({ optional: true })) groupId?: number,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('search') search = '',
  ) {
    return this.dashboardService.debtors({
      branchId,
      cycleId,
      groupId,
      page,
      search,
    });
  }

  @Get('pending')
  pending(
    @Query('branchId', new ParseIntPipe({ optional: true })) branchId?: number,
    @Query('cycleId', new ParseIntPipe({ optional: true })) cycleId?: number,
    @Query('groupId', new ParseIntPipe({ optional: true })) groupId?: number,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('search') search = '',
  ) {
    return this.dashboardService.pending({
      branchId,
      cycleId,
      groupId,
      page,
      search,
    });
  }

  @Get('debtors/export')
  async overdueExport(
    @Res() response: Response,
    @Query('branchId', new ParseIntPipe({ optional: true })) branchId?: number,
    @Query('cycleId', new ParseIntPipe({ optional: true })) cycleId?: number,
    @Query('groupId', new ParseIntPipe({ optional: true })) groupId?: number,
    @Query('search') search = '',
  ) {
    const content = await this.dashboardService.overdueExport({
      branchId,
      cycleId,
      groupId,
      search,
    });
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="estudiantes_morosos_${institutionToday()}.xlsx"`,
    );
    response.send(Buffer.from(content));
  }

  @Get('debtors/:enrollmentId')
  debtorDetail(
    @Param('enrollmentId', ParseIntPipe) enrollmentId: number,
    @Query('branchId', new ParseIntPipe({ optional: true })) branchId?: number,
    @Query('cycleId', new ParseIntPipe({ optional: true })) cycleId?: number,
    @Query('groupId', new ParseIntPipe({ optional: true })) groupId?: number,
  ) {
    return this.dashboardService.debtorDetail(enrollmentId, {
      branchId,
      cycleId,
      groupId,
    });
  }

  @Get('students/:studentId/financial-detail')
  studentFinancialDetail(
    @Param('studentId', ParseIntPipe) studentId: number,
    @Query('cycleId', ParseIntPipe) cycleId: number,
    @Query('branchId', new ParseIntPipe({ optional: true })) branchId?: number,
    @Query('groupId', new ParseIntPipe({ optional: true })) groupId?: number,
  ) {
    return this.dashboardService.studentFinancialDetail(studentId, {
      cycleId,
      branchId,
      groupId,
    });
  }
}
