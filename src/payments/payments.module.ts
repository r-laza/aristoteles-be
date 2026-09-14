import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { Roles } from '../auth/roles.guard';
import { PaymentsService } from './payments.service';

@Controller('admin/payments')
@Roles('ADMIN')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}
  @Get('cycles/:id') balances(@Param('id', ParseIntPipe) id: number) {
    return this.payments.balances(id);
  }
  @Get('enrollments/:id') history(@Param('id', ParseIntPipe) id: number) {
    return this.payments.history(id);
  }
  @Post('enrollments/:id') register(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ) {
    return this.payments.register(id, body);
  }
}
@Module({ controllers: [PaymentsController], providers: [PaymentsService] })
export class PaymentsModule {}
