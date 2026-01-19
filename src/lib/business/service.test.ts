import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest';
import {
  createBusiness,
  listBusinesses,
  getBusiness,
  updateBusiness,
  deleteBusiness,
  getWebhookSecret,
  regenerateWebhookSecret
} from './service';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as encryption from '../crypto/encryption';

// Set environment variables
beforeAll(() => {
  process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
});

// Mock encryption
vi.mock('../crypto/encryption', async () => {
  const actual = await vi.importActual('../crypto/encryption');
  return {
    ...actual,
    encrypt: vi.fn(),
    decrypt: vi.fn(),
  };
});

// Mock API key generation
vi.mock('../auth/apikey', () => ({
  generateApiKey: vi.fn(() => 'cp_live_' + 'a'.repeat(32)),
  validateApiKeyFormat: vi.fn(),
  getBusinessByApiKey: vi.fn(),
  regenerateApiKey: vi.fn(),
  isApiKey: vi.fn(),
}));

const createMockSupabaseClient = () => {
  const mockClient = {
    from: vi.fn(() => mockClient),
    select: vi.fn(() => mockClient),
    insert: vi.fn(() => mockClient),
    update: vi.fn(() => mockClient),
    delete: vi.fn(() => mockClient),
    eq: vi.fn(() => mockClient),
    single: vi.fn(),
  } as unknown as SupabaseClient;
  
  return mockClient;
};

describe('Business Service', () => {
  let mockSupabase: SupabaseClient;

  beforeEach(() => {
    mockSupabase = createMockSupabaseClient();
    vi.clearAllMocks();
    
    // Setup default encryption mocks
    vi.mocked(encryption.encrypt).mockReturnValue('encrypted-webhook-secret');
    vi.mocked(encryption.decrypt).mockReturnValue('decrypted-webhook-secret');
  });

  describe('createBusiness', () => {
    it('should create a new business successfully with API key', async () => {
      const mockBusiness = {
        id: 'business-123',
        merchant_id: 'merchant-123',
        name: 'Test Business',
        description: 'Test Description',
        webhook_url: 'https://example.com/webhook',
        active: true,
        api_key: 'cp_live_' + 'a'.repeat(32),
        api_key_created_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      };

      mockSupabase.from = vi.fn(() => ({
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: mockBusiness,
              error: null,
            }),
          })),
        })),
      })) as any;

      const result = await createBusiness(mockSupabase, 'merchant-123', {
        name: 'Test Business',
        description: 'Test Description',
        webhook_url: 'https://example.com/webhook',
        webhook_secret: 'my-secret',
      });

      expect(result.success).toBe(true);
      expect(result.business).toBeDefined();
      expect(result.business?.name).toBe('Test Business');
      expect(result.business?.api_key).toBeDefined();
      expect(result.business?.api_key).toMatch(/^cp_live_/);
      expect(result.business?.api_key_created_at).toBeDefined();
      expect(encryption.encrypt).toHaveBeenCalledWith('my-secret', expect.any(String));
    });

    it('should auto-generate API key on business creation', async () => {
      const mockBusiness = {
        id: 'business-123',
        merchant_id: 'merchant-123',
        name: 'Test Business',
        active: true,
        api_key: 'cp_live_' + 'b'.repeat(32),
        api_key_created_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      };

      mockSupabase.from = vi.fn(() => ({
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: mockBusiness,
              error: null,
            }),
          })),
        })),
      })) as any;

      const result = await createBusiness(mockSupabase, 'merchant-123', {
        name: 'Test Business',
      });

      if (!result.success) {
        console.log('Error:', result.error);
      }

      expect(result.success).toBe(true);
      expect(result.business?.api_key).toBeDefined();
      expect(result.business?.api_key).toMatch(/^cp_live_/);
      expect(result.business?.api_key_created_at).toBeDefined();
    });

    it('should validate business name is required', async () => {
      const result = await createBusiness(mockSupabase, 'merchant-123', {
        name: '',
        description: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('name');
    });

    it('should validate webhook URL format', async () => {
      const result = await createBusiness(mockSupabase, 'merchant-123', {
        name: 'Test Business',
        webhook_url: 'invalid-url',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('URL');
    });

    it('should handle database errors', async () => {
      mockSupabase.from = vi.fn(() => ({
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Database error' },
            }),
          })),
        })),
      })) as any;

      const result = await createBusiness(mockSupabase, 'merchant-123', {
        name: 'Test Business',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('listBusinesses', () => {
    it('should list all businesses for a merchant', async () => {
      mockSupabase.from = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({
            data: [
              { id: 'biz-1', name: 'Business 1', active: true },
              { id: 'biz-2', name: 'Business 2', active: true },
            ],
            error: null,
          }),
        })),
      })) as any;

      const result = await listBusinesses(mockSupabase, 'merchant-123');

      expect(result.success).toBe(true);
      expect(result.businesses).toHaveLength(2);
    });

    it('should return empty array when no businesses', async () => {
      mockSupabase.from = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({
            data: [],
            error: null,
          }),
        })),
      })) as any;

      const result = await listBusinesses(mockSupabase, 'merchant-123');

      expect(result.success).toBe(true);
      expect(result.businesses).toHaveLength(0);
    });

    it('should handle database errors', async () => {
      mockSupabase.from = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'Database error' },
          }),
        })),
      })) as any;

      const result = await listBusinesses(mockSupabase, 'merchant-123');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('getBusiness', () => {
    it('should get a business by ID', async () => {
      mockSupabase.from = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'business-123',
                  name: 'Test Business',
                  merchant_id: 'merchant-123',
                },
                error: null,
              }),
            })),
          })),
        })),
      })) as any;

      const result = await getBusiness(mockSupabase, 'business-123', 'merchant-123');

      expect(result.success).toBe(true);
      expect(result.business).toBeDefined();
      expect(result.business?.id).toBe('business-123');
    });

    it('should return error when business not found', async () => {
      mockSupabase.from = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Not found' },
              }),
            })),
          })),
        })),
      })) as any;

      const result = await getBusiness(mockSupabase, 'business-123', 'merchant-123');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('updateBusiness', () => {
    it('should update business successfully', async () => {
      mockSupabase.from = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { webhook_url: null, webhook_secret: null },
                error: null,
              }),
            })),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'business-123',
                    name: 'Updated Business',
                    description: 'Updated Description',
                  },
                  error: null,
                }),
              })),
            })),
          })),
        })),
      })) as any;

      const result = await updateBusiness(mockSupabase, 'business-123', 'merchant-123', {
        name: 'Updated Business',
        description: 'Updated Description',
      });

      expect(result.success).toBe(true);
      expect(result.business?.name).toBe('Updated Business');
    });

    it('should encrypt webhook secret when updating', async () => {
      mockSupabase.from = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { webhook_url: 'https://example.com/webhook', webhook_secret: 'existing-secret' },
                error: null,
              }),
            })),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'business-123', name: 'Test' },
                  error: null,
                }),
              })),
            })),
          })),
        })),
      })) as any;

      await updateBusiness(mockSupabase, 'business-123', 'merchant-123', {
        webhook_secret: 'new-secret',
      });

      expect(encryption.encrypt).toHaveBeenCalledWith('new-secret', expect.any(String));
    });
  });

  describe('deleteBusiness', () => {
    it('should delete business successfully', async () => {
      mockSupabase.from = vi.fn(() => ({
        delete: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: null,
              error: null,
            }),
          })),
        })),
      })) as any;

      const result = await deleteBusiness(mockSupabase, 'business-123', 'merchant-123');

      expect(result.success).toBe(true);
    });

    it('should handle deletion errors', async () => {
      mockSupabase.from = vi.fn(() => ({
        delete: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Cannot delete' },
            }),
          })),
        })),
      })) as any;

      const result = await deleteBusiness(mockSupabase, 'business-123', 'merchant-123');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

  describe('getWebhookSecret', () => {
    it('should retrieve and decrypt webhook secret', async () => {
      mockSupabase.from = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { webhook_secret: 'encrypted-secret' },
                error: null,
              }),
            })),
          })),
        })),
      })) as any;

      vi.mocked(encryption.decrypt).mockReturnValue('decrypted-secret-123');

      const result = await getWebhookSecret(mockSupabase, 'business-123', 'merchant-123');

      expect(result.success).toBe(true);
      expect(result.secret).toBe('decrypted-secret-123');
      expect(encryption.decrypt).toHaveBeenCalledWith('encrypted-secret', expect.any(String));
    });

    it('should return error when business not found', async () => {
      mockSupabase.from = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Not found' },
              }),
            })),
          })),
        })),
      })) as any;

      const result = await getWebhookSecret(mockSupabase, 'business-123', 'merchant-123');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Not found');
    });

    it('should return error when no webhook secret configured', async () => {
      mockSupabase.from = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { webhook_secret: null },
                error: null,
              }),
            })),
          })),
        })),
      })) as any;

      const result = await getWebhookSecret(mockSupabase, 'business-123', 'merchant-123');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No webhook secret');
    });
  });

  describe('regenerateWebhookSecret', () => {
    it('should generate and encrypt new webhook secret', async () => {
      mockSupabase.from = vi.fn(() => ({
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: null,
              error: null,
            }),
          })),
        })),
      })) as any;

      vi.mocked(encryption.encrypt).mockReturnValue('new-encrypted-secret');

      const result = await regenerateWebhookSecret(mockSupabase, 'business-123', 'merchant-123');

      expect(result.success).toBe(true);
      expect(result.secret).toBeDefined();
      expect(result.secret?.startsWith('whsecret_')).toBe(true); // Should have prefix
      expect(result.secret?.length).toBe(73); // 'whsecret_' (9 chars) + 32 bytes (64 hex chars) = 73
      expect(encryption.encrypt).toHaveBeenCalled();
    });

    it('should handle database errors during regeneration', async () => {
      mockSupabase.from = vi.fn(() => ({
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Update failed' },
            }),
          })),
        })),
      })) as any;

      const result = await regenerateWebhookSecret(mockSupabase, 'business-123', 'merchant-123');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Update failed');
    });
  });
  });
});