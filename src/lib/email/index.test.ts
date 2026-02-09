import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the provider modules
vi.mock('./resend', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true, messageId: 'resend_123' }),
  sendBulkEmails: vi.fn().mockResolvedValue([{ success: true, messageId: 'resend_123' }]),
}));

vi.mock('./mailgun', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true, messageId: 'mailgun_123' }),
  sendBulkEmails: vi.fn().mockResolvedValue([{ success: true, messageId: 'mailgun_123' }]),
}));

import { sendEmail, sendBulkEmails } from './index';
import { sendEmail as resendSendEmail, sendBulkEmails as resendSendBulkEmails } from './resend';
import { sendEmail as mailgunSendEmail, sendBulkEmails as mailgunSendBulkEmails } from './mailgun';

const testEmail = {
  to: 'merchant@example.com',
  subject: 'Test Email',
  html: '<p>Test content</p>',
};

describe('Email Service Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.RESEND_API_KEY;
    delete process.env.MAILGUN_API_KEY;
  });

  describe('sendEmail', () => {
    it('should use Resend when RESEND_API_KEY is set', async () => {
      process.env.RESEND_API_KEY = 'test-resend-key';

      const result = await sendEmail(testEmail);

      expect(resendSendEmail).toHaveBeenCalledWith(testEmail);
      expect(mailgunSendEmail).not.toHaveBeenCalled();
      expect(result.messageId).toBe('resend_123');
    });

    it('should fall back to Mailgun when RESEND_API_KEY is not set', async () => {
      process.env.MAILGUN_API_KEY = 'test-mailgun-key';

      const result = await sendEmail(testEmail);

      expect(mailgunSendEmail).toHaveBeenCalledWith(testEmail);
      expect(resendSendEmail).not.toHaveBeenCalled();
      expect(result.messageId).toBe('mailgun_123');
    });

    it('should prefer Resend when both are configured', async () => {
      process.env.RESEND_API_KEY = 'test-resend-key';
      process.env.MAILGUN_API_KEY = 'test-mailgun-key';

      const result = await sendEmail(testEmail);

      expect(resendSendEmail).toHaveBeenCalledWith(testEmail);
      expect(mailgunSendEmail).not.toHaveBeenCalled();
      expect(result.messageId).toBe('resend_123');
    });
  });

  describe('sendBulkEmails', () => {
    const emails = [testEmail, { ...testEmail, to: 'other@example.com' }];

    it('should use Resend for bulk when RESEND_API_KEY is set', async () => {
      process.env.RESEND_API_KEY = 'test-resend-key';

      await sendBulkEmails(emails);

      expect(resendSendBulkEmails).toHaveBeenCalledWith(emails);
      expect(mailgunSendBulkEmails).not.toHaveBeenCalled();
    });

    it('should fall back to Mailgun for bulk when RESEND_API_KEY is not set', async () => {
      process.env.MAILGUN_API_KEY = 'test-mailgun-key';

      await sendBulkEmails(emails);

      expect(mailgunSendBulkEmails).toHaveBeenCalledWith(emails);
      expect(resendSendBulkEmails).not.toHaveBeenCalled();
    });
  });
});
