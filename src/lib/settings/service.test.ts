import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSettings, updateSettings } from './service';

describe('Settings Service', () => {
  let mockSupabase: SupabaseClient;

  beforeEach(() => {
    mockSupabase = {
      from: vi.fn(),
    } as any;
  });

  describe('getSettings', () => {
    it('should retrieve merchant settings successfully', async () => {
      const mockSettings = {
        merchant_id: 'merchant-123',
        notifications_enabled: true,
        email_notifications: true,
        web_notifications: false,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      mockSupabase.from = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: mockSettings,
              error: null,
            }),
          })),
        })),
      })) as any;

      const result = await getSettings(mockSupabase, 'merchant-123');

      expect(result.success).toBe(true);
      expect(result.settings).toEqual(mockSettings);
      expect(mockSupabase.from).toHaveBeenCalledWith('merchant_settings');
    });

    it('should return default settings if none exist', async () => {
      mockSupabase.from = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { code: 'PGRST116' }, // Not found error
            }),
          })),
        })),
      })) as any;

      const result = await getSettings(mockSupabase, 'merchant-123');

      expect(result.success).toBe(true);
      expect(result.settings).toEqual({
        notifications_enabled: true,
        email_notifications: true,
        web_notifications: false,
      });
    });

    it('should handle database errors', async () => {
      mockSupabase.from = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Database error' },
            }),
          })),
        })),
      })) as any;

      const result = await getSettings(mockSupabase, 'merchant-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
    });

    it('should handle missing merchant ID', async () => {
      const result = await getSettings(mockSupabase, '');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Merchant ID is required');
    });
  });

  describe('updateSettings', () => {
    it('should update merchant settings successfully', async () => {
      const updateData = {
        notifications_enabled: false,
        email_notifications: false,
      };

      const updatedSettings = {
        merchant_id: 'merchant-123',
        notifications_enabled: false,
        email_notifications: false,
        web_notifications: false,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      mockSupabase.from = vi.fn(() => ({
        upsert: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: updatedSettings,
                error: null,
              }),
            })),
          })),
        })),
      })) as any;

      const result = await updateSettings(mockSupabase, 'merchant-123', updateData);

      expect(result.success).toBe(true);
      expect(result.settings).toEqual(updatedSettings);
    });

    it('should validate update data', async () => {
      const result = await updateSettings(mockSupabase, 'merchant-123', {});

      expect(result.success).toBe(false);
      expect(result.error).toBe('At least one setting must be provided');
    });

    it('should handle database errors during update', async () => {
      mockSupabase.from = vi.fn(() => ({
        upsert: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Update failed' },
              }),
            })),
          })),
        })),
      })) as any;

      const result = await updateSettings(mockSupabase, 'merchant-123', {
        notifications_enabled: false,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Update failed');
    });

    it('should only update provided fields', async () => {
      const updateData = {
        email_notifications: false,
      };

      let upsertedData: any;
      mockSupabase.from = vi.fn(() => ({
        upsert: vi.fn((data) => {
          upsertedData = data;
          return {
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { ...data, created_at: '2024-01-01', updated_at: '2024-01-01' },
                  error: null,
                }),
              })),
            })),
          };
        }),
      })) as any;

      await updateSettings(mockSupabase, 'merchant-123', updateData);

      expect(upsertedData).toHaveProperty('merchant_id', 'merchant-123');
      expect(upsertedData).toHaveProperty('email_notifications', false);
      expect(upsertedData).not.toHaveProperty('notifications_enabled');
      expect(upsertedData).not.toHaveProperty('web_notifications');
    });
  });
});