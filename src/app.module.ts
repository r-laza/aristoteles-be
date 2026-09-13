import { Module } from '@nestjs/common';
import { DashboardModule } from './dashboard/dashboard.module';
import { PrismaModule } from './database/prisma.module';

@Module({
  imports: [PrismaModule, DashboardModule],
})
export class AppModule {}
