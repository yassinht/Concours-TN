import { Global, Module } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { MailService } from './mail.service';
import { NotificationsController, PushController } from './notifications.controller';
import { NotificationsCron } from './notifications.cron';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';

/** Notifications module — in-app inbox, web push, email, concours alerts and scheduled reminders (docs/api-contract.md). */
@Global()
@Module({
  imports: [],
  controllers: [NotificationsController, PushController],
  providers: [NotificationsService, MailService, AlertsService, PushService, NotificationsCron],
  exports: [NotificationsService, MailService, AlertsService, PushService, NotificationsCron],
})
export class NotificationsModule {}
