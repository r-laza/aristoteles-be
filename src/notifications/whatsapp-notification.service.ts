import { BadRequestException, Injectable } from '@nestjs/common';
import {
  SendWhatsAppMessageCommand,
  SocialMessagingClient,
} from '@aws-sdk/client-socialmessaging';
import { notificationConfig } from './notification.config';

export type PensionReminderMessage = {
  representativeName: string;
  studentName: string;
  period: string;
  dueDate: Date;
  pendingAmount: string;
};

@Injectable()
export class WhatsAppNotificationService {
  normalizePhone(value: string | null | undefined): string | null {
    if (!value) return null;
    let digits = value.trim().replace(/[^\d+]/g, '');
    if (digits.startsWith('+')) digits = digits.slice(1);
    else if (digits.startsWith('00')) digits = digits.slice(2);
    else if (/^0?9\d{8}$/.test(digits)) digits = `51${digits.replace(/^0/, '')}`;
    return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
  }

  async sendTemplate(phone: string, values: PensionReminderMessage) {
    const config = notificationConfig();
    if (!config.enabled) throw new BadRequestException('WhatsApp is disabled');
    if (config.provider !== 'aws') throw new Error('Unsupported WhatsApp provider');
    if (!config.region || !config.senderId || !config.templateName)
      throw new Error('WhatsApp provider is not configured');
    const normalized = this.normalizePhone(phone);
    if (!normalized) throw new BadRequestException('Invalid representative phone');
    const message = {
      messaging_product: 'whatsapp',
      to: normalized.slice(1),
      type: 'template',
      template: {
        name: config.templateName,
        language: { code: 'es' },
        components: [{
          type: 'body',
          parameters: [
            values.representativeName,
            values.studentName,
            this.periodLabel(values.period),
            this.dateLabel(values.dueDate),
            values.pendingAmount,
            config.academyName,
          ].map((text) => ({ type: 'text', text })),
        }],
      },
    };
    const client = new SocialMessagingClient({ region: config.region });
    const result = await client.send(new SendWhatsAppMessageCommand({
      originationPhoneNumberId: config.senderId,
      metaApiVersion: 'v20.0',
      message: Buffer.from(JSON.stringify(message)),
    }));
    if (!result.messageId) throw new Error('Provider did not return a message id');
    return result.messageId;
  }

  private periodLabel(period: string) {
    const [year, month] = period.split('-').map(Number);
    return new Intl.DateTimeFormat('es-PE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1)));
  }

  private dateLabel(value: Date) {
    return new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(value);
  }
}
