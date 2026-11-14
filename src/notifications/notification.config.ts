export type NotificationConfig = ReturnType<typeof notificationConfig>;

export function notificationConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsedDays = Number(env.WHATSAPP_REMINDER_DAYS ?? '2');
  return {
    appEnv: env.APP_ENV ?? 'local',
    enabled: env.WHATSAPP_ENABLED === 'true',
    provider: env.WHATSAPP_PROVIDER ?? 'aws',
    reminderDays: Number.isInteger(parsedDays) && parsedDays > 0 ? parsedDays : 2,
    region: env.AWS_REGION?.trim() ?? '',
    senderId: env.WHATSAPP_SENDER_ID?.trim() ?? '',
    templateName: env.WHATSAPP_TEMPLATE_NAME?.trim() ?? '',
    academyName: env.ACADEMY_NAME?.trim() || 'Academia Aristóteles',
  };
}
