import { logger } from '../common/request-id.middleware.js';

/** Outgoing email (system-logic §7.7.9). Real SMTP is a later adapter behind the same port. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}
export interface MailTransport {
  send(message: MailMessage): Promise<void>;
}
export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

/** Default: writes the message to the log instead of sending it. */
export class LogTransport implements MailTransport {
  send(message: MailMessage) {
    logger.info({ mail: { to: message.to, subject: message.subject } }, message.text);
    return Promise.resolve();
  }
}

/** Tests: keeps the messages in memory. */
export class NoopTransport implements MailTransport {
  readonly sent: MailMessage[] = [];
  send(message: MailMessage) {
    this.sent.push(message);
    return Promise.resolve();
  }
}

export function mailTransport(kind: string | undefined): MailTransport {
  return kind === 'noop' ? new NoopTransport() : new LogTransport();
}
