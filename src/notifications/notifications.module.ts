import {
  Controller,
  Get,
  Module,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { Roles } from '../auth/roles.guard';
import { notificationConfig } from './notification.config';
import { NotificationTriggerService } from './notification-trigger.service';
import { PaymentReminderService } from './payment-reminder.service';
import { WhatsAppNotificationService } from './whatsapp-notification.service';

@Controller('admin/notifications')
@Roles('ADMIN')
export class NotificationsController {
  constructor(private readonly reminders: PaymentReminderService) {}
  @Get('capabilities') capabilities() {
    const config = notificationConfig();
    return { manualEnabled: config.appEnv === 'local' && config.enabled };
  }
  @Post('students/:id/send') send(@Param('id', ParseIntPipe) id: number) {
    return this.reminders.sendManual(id);
  }
  @Post('process-reminders') process() {
    return this.reminders.processAutomatic();
  }
}

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [NotificationsController],
  providers: [
    WhatsAppNotificationService,
    PaymentReminderService,
    NotificationTriggerService,
  ],
  exports: [PaymentReminderService],
})
export class NotificationsModule {}
