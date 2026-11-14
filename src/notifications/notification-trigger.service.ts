import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PaymentReminderService } from './payment-reminder.service';

@Injectable()
export class NotificationTriggerService {
  constructor(private readonly reminders: PaymentReminderService) {}

  @Cron('0 9 * * *', { timeZone: 'America/Guayaquil' })
  runDaily() {
    return this.reminders.processAutomatic();
  }
}
