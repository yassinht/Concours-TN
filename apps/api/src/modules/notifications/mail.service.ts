import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env';
import type { Database } from '../../db/client';
import { InjectDb } from '../../db/db.module';
import { emailOutbox } from '../../db/schema';
import { errorMessage } from './notifications.util';

export interface MailOptions {
  /** Extra headers, e.g. List-Unsubscribe / List-Unsubscribe-Post (RFC 8058) on notification emails. */
  headers?: Record<string, string>;
}

const EMAIL_RE = /^[^\s@<>()"',;:\\]+@[^\s@<>()"',;:\\]+\.[^\s@<>()"',;:\\]+$/;

function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|h\d|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * CONTRACT (owned by the notifications module):
 * - send(to, subject, html, text?) → writes email_outbox; sends via SMTP when configured, else status LOGGED (and logs to console in dev).
 *   Throws when the SMTP relay rejects the message (the outbox row is marked FAILED first) — callers decide whether that matters.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger('MailService');
  private transporter: Transporter | null = null;
  private warnedNoSmtp = false;

  constructor(@InjectDb() private readonly db: Database) {}

  async send(to: string, subject: string, html: string, text?: string, opts: MailOptions = {}): Promise<void> {
    const recipient = (to ?? '').trim();
    if (!EMAIL_RE.test(recipient) || recipient.length > 254) throw new Error('INVALID_RECIPIENT');
    const cleanSubject = subject.replace(/[\r\n]+/g, ' ').trim().slice(0, 300);
    const plain = text ?? htmlToText(html);
    const smtp = !!env().SMTP_HOST;

    const [row] = await this.db
      .insert(emailOutbox)
      .values({ to: recipient, subject: cleanSubject, html, text: plain, status: smtp ? 'PENDING' : 'LOGGED' })
      .returning({ id: emailOutbox.id });

    if (!smtp) {
      if (env().NODE_ENV === 'development') {
        this.logger.log(`[email LOGGED] to=${recipient} subject="${cleanSubject}"\n${plain}`);
      } else if (env().NODE_ENV === 'production' && !this.warnedNoSmtp) {
        this.warnedNoSmtp = true;
        this.logger.warn('SMTP_HOST is not set: emails are only written to email_outbox (status LOGGED).');
      }
      return;
    }

    try {
      await this.smtp().sendMail({ from: env().MAIL_FROM, to: recipient, subject: cleanSubject, html, text: plain, headers: opts.headers });
      await this.db.update(emailOutbox).set({ status: 'SENT', sentAt: new Date(), error: null }).where(eq(emailOutbox.id, row.id));
    } catch (e) {
      await this.db.update(emailOutbox).set({ status: 'FAILED', error: errorMessage(e) }).where(eq(emailOutbox.id, row.id));
      throw e;
    }
  }

  private smtp(): Transporter {
    if (!this.transporter) {
      const e = env();
      this.transporter = nodemailer.createTransport({
        host: e.SMTP_HOST,
        port: e.SMTP_PORT,
        secure: e.SMTP_PORT === 465,
        auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASS ?? '' } : undefined,
        pool: true,
        maxConnections: 3,
        connectionTimeout: 15_000,
        greetingTimeout: 10_000,
        socketTimeout: 30_000,
      });
    }
    return this.transporter;
  }
}
