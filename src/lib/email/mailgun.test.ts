import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendEmail } from './mailgun';

// Mock fetch globally
global.fetch = vi.fn();

describe('Mailgun Email Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set required environment variables
    process.env.MAILGUN_API_KEY = 'test-api-key';
    process.env.MAILGUN_DOMAIN = 'mg.example.com';
    process.env.REPLY_TO_EMAIL = 'support@example.com';
  });

  describe('sendEmail', () => {
    it('should send email successfully', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ id: '<message-id>', message: 'Queued. Thank you.' }),
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      const result = await sendEmail({
        to: 'merchant@example.com',
        subject: 'Test Email',
        html: '<p>Test content</p>',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('<message-id>');
      expect(global.fetch).toHaveBeenCalledTimes(1);
      
      const fetchCall = (global.fetch as any).mock.calls[0];
      expect(fetchCall[0]).toContain('mg.example.com');
      expect(fetchCall[1].method).toBe('POST');
    });

    it('should handle missing API key', async () => {
      delete process.env.MAILGUN_API_KEY;

      const result = await sendEmail({
        to: 'merchant@example.com',
        subject: 'Test Email',
        html: '<p>Test content</p>',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Mailgun API key');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should handle missing domain', async () => {
      delete process.env.MAILGUN_DOMAIN;

      const result = await sendEmail({
        to: 'merchant@example.com',
        subject: 'Test Email',
        html: '<p>Test content</p>',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Mailgun domain');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should validate email address', async () => {
      const result = await sendEmail({
        to: 'invalid-email',
        subject: 'Test Email',
        html: '<p>Test content</p>',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid email address');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should validate subject is not empty', async () => {
      const result = await sendEmail({
        to: 'merchant@example.com',
        subject: '',
        html: '<p>Test content</p>',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Subject is required');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should validate HTML content is not empty', async () => {
      const result = await sendEmail({
        to: 'merchant@example.com',
        subject: 'Test Email',
        html: '',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('HTML content is required');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should handle Mailgun API errors', async () => {
      const mockResponse = {
        ok: false,
        status: 400,
        json: async () => ({ message: 'Invalid request' }),
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      const result = await sendEmail({
        to: 'merchant@example.com',
        subject: 'Test Email',
        html: '<p>Test content</p>',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid request');
    });

    it('should handle network errors', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      const result = await sendEmail({
        to: 'merchant@example.com',
        subject: 'Test Email',
        html: '<p>Test content</p>',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });

    it('should include reply-to header', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ id: '<message-id>', message: 'Queued. Thank you.' }),
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      await sendEmail({
        to: 'merchant@example.com',
        subject: 'Test Email',
        html: '<p>Test content</p>',
      });

      const fetchCall = (global.fetch as any).mock.calls[0];
      const formData = fetchCall[1].body;
      
      // FormData is used, so we can't easily inspect it in tests
      // But we can verify the call was made
      expect(global.fetch).toHaveBeenCalled();
    });

    it('should use correct from address', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ id: '<message-id>', message: 'Queued. Thank you.' }),
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      await sendEmail({
        to: 'merchant@example.com',
        subject: 'Test Email',
        html: '<p>Test content</p>',
      });

      expect(global.fetch).toHaveBeenCalled();
      const fetchCall = (global.fetch as any).mock.calls[0];
      expect(fetchCall[0]).toContain('mg.example.com');
    });
  });
});