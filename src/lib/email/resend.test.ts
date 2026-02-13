import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendEmail } from './resend';

// Mock fetch globally
global.fetch = vi.fn();

describe('Resend Email Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set required environment variables
    process.env.RESEND_API_KEY = 'test-api-key';
    process.env.REPLY_TO_EMAIL = 'support@example.com';
  });

  describe('sendEmail', () => {
    it('should send email successfully', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ id: 'msg_123' }),
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      const result = await sendEmail({
        to: 'merchant@example.com',
        subject: 'Test Email',
        html: '<p>Test content</p>',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg_123');
      expect(global.fetch).toHaveBeenCalledTimes(1);

      const fetchCall = (global.fetch as any).mock.calls[0];
      expect(fetchCall[0]).toBe('https://api.resend.com/emails');
      expect(fetchCall[1].method).toBe('POST');
      expect(fetchCall[1].headers['Content-Type']).toBe('application/json');
      expect(fetchCall[1].headers['Authorization']).toBe('Bearer test-api-key');
    });

    it('should handle missing API key', async () => {
      delete process.env.RESEND_API_KEY;

      const result = await sendEmail({
        to: 'merchant@example.com',
        subject: 'Test Email',
        html: '<p>Test content</p>',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Resend API key');
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

    it('should handle Resend API errors', async () => {
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

    it('should send correct JSON body', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ id: 'msg_123' }),
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      await sendEmail({
        to: 'merchant@example.com',
        subject: 'Test Email',
        html: '<p>Test content</p>',
      });

      const fetchCall = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.to).toEqual(['merchant@example.com']);
      expect(body.subject).toBe('Test Email');
      expect(body.html).toBe('<p>Test content</p>');
      expect(body.reply_to).toBe('support@example.com');
      expect(body.from).toContain('CoinPay');
    });

    it('should use custom from address when provided', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ id: 'msg_123' }),
      };
      (global.fetch as any).mockResolvedValue(mockResponse);

      await sendEmail({
        to: 'merchant@example.com',
        subject: 'Test Email',
        html: '<p>Test content</p>',
        from: 'Custom <custom@example.com>',
      });

      const fetchCall = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.from).toBe('Custom <custom@example.com>');
    });
  });
});
