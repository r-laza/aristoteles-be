import { PaymentsModule } from './payments/payments.module';
import { CyclesModule } from './cycles/cycles.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { Module } from '@nestjs/common';
import { DashboardModule } from './dashboard/dashboard.module';
import { PrismaModule } from './database/prisma.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    AdminModule,
    DashboardModule,
    CyclesModule,
    PaymentsModule,
  ],
})
export class AppModule {}
