import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { MailService } from './mail.service';
import { AlertsService } from './alerts.service';

/** Notifications module — see docs/api-contract.md for its endpoints. */
@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [NotificationsService, MailService, AlertsService],
  exports: [NotificationsService, MailService, AlertsService],
})
export class NotificationsModule {}
