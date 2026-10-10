import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { AdminDashboardController } from './admin-dashboard.controller';

@Module({
  controllers: [DashboardController, AdminDashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
