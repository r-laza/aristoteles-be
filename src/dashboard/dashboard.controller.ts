import { Roles } from '../auth/roles.guard';
import { Controller, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardDto } from './dashboard.types';

@Controller('dashboard')
@Roles('STUDENT')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  async getDashboard(): Promise<DashboardDto> {
    return this.dashboardService.getDashboard();
  }
}
