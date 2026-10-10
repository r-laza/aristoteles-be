import { Controller, Get, ParseIntPipe, Query } from '@nestjs/common';
import { Roles } from '../auth/roles.guard';
import { DashboardService } from './dashboard.service';

@Controller('admin/dashboard')
@Roles('ADMIN')
export class AdminDashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  getDashboard(
    @Query('cycleId', new ParseIntPipe({ optional: true })) cycleId?: number,
  ) {
    return this.dashboardService.getAdminDashboard(cycleId);
  }
}
