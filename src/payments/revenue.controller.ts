import { Controller, Get, Query, Req } from '@nestjs/common';
import type { AuthRequest } from '../auth/auth.types';
import { Roles } from '../auth/roles.guard';
import { RevenueService } from './revenue.service';

@Controller('admin/revenue')
@Roles('ADMIN')
export class RevenueController {
  constructor(private readonly revenue: RevenueService) {}

  @Get()
  report(
    @Req() request: AuthRequest,
    @Query() query: Record<string, unknown>,
  ) {
    return this.revenue.report(request.user, query);
  }
}
