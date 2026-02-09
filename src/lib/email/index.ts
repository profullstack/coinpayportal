/**
 * Email Service
 *
 * Routes to Resend (preferred) or Mailgun based on which env vars are set.
 * Resend is used when RESEND_API_KEY is configured.
 * Mailgun is used as a fallback when only MAILGUN_API_KEY + MAILGUN_DOMAIN are configured.
 */

import { sendEmail as resendSendEmail, sendBulkEmails as resendSendBulkEmails } from './resend';
import { sendEmail as mailgunSendEmail, sendBulkEmails as mailgunSendBulkEmails } from './mailgun';
import type { SendEmailInput, SendEmailResult } from './resend';

export type { SendEmailInput, SendEmailResult };

function useResend(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (useResend()) {
    return resendSendEmail(input);
  }
  return mailgunSendEmail(input);
}

export async function sendBulkEmails(emails: SendEmailInput[]): Promise<SendEmailResult[]> {
  if (useResend()) {
    return resendSendBulkEmails(emails);
  }
  return mailgunSendBulkEmails(emails);
}
