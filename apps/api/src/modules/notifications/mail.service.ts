import { Injectable } from '@nestjs/common';

/**
 * CONTRACT (owned by the notifications module):
 * - send(to, subject, html, text?) → writes email_outbox; sends via SMTP when configured, else status LOGGED (and logs to console in dev).
 */
@Injectable()
export class MailService {
  async send(_to: string, _subject: string, _html: string, _text?: string): Promise<void> {
    throw new Error('NOT_IMPLEMENTED');
  }
}
