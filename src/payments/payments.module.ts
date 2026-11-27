import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Module,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { AuthRequest } from '../auth/auth.types';
import { Roles } from '../auth/roles.guard';
import { PaymentsService } from './payments.service';
import { StorageModule } from '../storage/storage.module';
import {
  PAYMENT_EVIDENCE_MAX_BYTES,
  PAYMENT_EVIDENCE_MIME_TYPES,
} from '../storage/storage.service';
import { RevenueController } from './revenue.controller';
import { RevenueService } from './revenue.service';
import { CyclesModule } from '../cycles/cycles.module';

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
  @Get(':id/receipt') receipt(@Param('id', ParseIntPipe) id: number) {
    return this.payments.receipt(id);
  }
  @Get(':id/evidence')
  async evidence(
    @Param('id', ParseIntPipe) id: number,
    @Query('download') download: string | undefined,
    @Res() response: Response,
  ) {
    const evidence = await this.payments.evidence(id);
    const disposition = download === '1' ? 'attachment' : 'inline';
    response.setHeader('Content-Type', evidence.mimeType);
    response.setHeader('Content-Length', evidence.body.length);
    response.setHeader(
      'Content-Disposition',
      `${disposition}; filename*=UTF-8''${encodeURIComponent(evidence.originalName)}`,
    );
    response.send(evidence.body);
  }
  @Post(':id/receipt') createReceipt(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ) {
    return this.payments.createReceipt(id, body);
  }
  @Post('enrollments/:id') register(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() request: AuthRequest,
  ) {
    return this.payments.register(id, body, request.user.id);
  }
  @Post('initial-enrollment') registerInitial(
    @Body() body: { cycleId?: unknown; enrollment?: unknown; payment?: unknown },
    @Req() request: AuthRequest,
  ) {
    const cycleId = Number(body?.cycleId);
    if (!Number.isSafeInteger(cycleId) || cycleId <= 0)
      throw new BadRequestException();
    return this.payments.registerInitial(
      cycleId,
      body.enrollment,
      body.payment,
      request.user.id,
    );
  }
  @Post(':id/evidence')
  @UseInterceptors(
    FileInterceptor('evidence', {
      limits: { fileSize: PAYMENT_EVIDENCE_MAX_BYTES, files: 1 },
      fileFilter: (_request, file, callback) =>
        callback(
          null,
          PAYMENT_EVIDENCE_MIME_TYPES.includes(
            file.mimetype as (typeof PAYMENT_EVIDENCE_MIME_TYPES)[number],
          ),
        ),
    }),
  )
  uploadEvidence(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.payments.uploadEvidence(id, file);
  }
}
@Module({
  imports: [StorageModule, CyclesModule],
  controllers: [PaymentsController, RevenueController],
  providers: [PaymentsService, RevenueService],
})
export class PaymentsModule {}
