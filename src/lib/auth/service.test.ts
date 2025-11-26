import { describe, it, expect, beforeEach, vi, beforeAll, afterEach } from 'vitest';
import { register, login, verifySession } from './service';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as encryption from '../crypto/encryption';
import * as jwt from './jwt';

// Set JWT_SECRET for tests
beforeAll(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-purposes-only';
});

// Mock the encryption and JWT modules
vi.mock('../crypto/encryption', async () => {
  const actual = await vi.importActual('../crypto/encryption');
  return {
    ...actual,
    hashPassword: vi.fn(),
    verifyPassword: vi.fn(),
  };
});

vi.mock('./jwt', async () => {
  const actual = await vi.importActual('./jwt');
  return {
    ...actual,
    generateToken: vi.fn(),
    verifyToken: vi.fn(),
  };
});

// Mock Supabase client
const createMockSupabaseClient = () => {
  const mockClient = {
    from: vi.fn(() => mockClient),
    select: vi.fn(() => mockClient),
    insert: vi.fn(() => mockClient),
    eq: vi.fn(() => mockClient),
    single: vi.fn(),
  } as unknown as SupabaseClient;
  
  return mockClient;
};

describe('Auth Service', () => {
  let mockSupabase: SupabaseClient;

  beforeEach(() => {
    mockSupabase = createMockSupabaseClient();
    vi.clearAllMocks();
    
    // Setup default mocks
    vi.mocked(encryption.hashPassword).mockResolvedValue('$2a$12$hashedpassword');
    vi.mocked(encryption.verifyPassword).mockResolvedValue(true);
    vi.mocked(jwt.generateToken).mockReturnValue('mock-jwt-token');
    vi.mocked(jwt.verifyToken).mockReturnValue({ userId: 'merchant-123', email: 'test@example.com' });
  });

  describe('register', () => {
    it('should register a new merchant successfully', async () => {
      let callCount = 0;
      mockSupabase.from = vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          // First call: check if email exists
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({ data: null, error: null }),
              })),
            })),
          };
        } else {
          // Second call: insert new merchant
          return {
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'merchant-123',
                    email: 'test@example.com',
                    name: 'Test Merchant',
                    created_at: new Date().toISOString(),
                  },
                  error: null,
                }),
              })),
            })),
          };
        }
      }) as any;

      const result = await register(mockSupabase, {
        email: 'test@example.com',
        password: 'SecurePassword123!',
        name: 'Test Merchant',
      });

      expect(result.success).toBe(true);
      expect(result.merchant).toBeDefined();
      expect(result.merchant?.email).toBe('test@example.com');
      expect(result.token).toBeDefined();
    });

    it('should reject registration with existing email', async () => {
      mockSupabase.from = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { id: 'existing-merchant', email: 'test@example.com' },
              error: null,
            }),
          })),
        })),
      })) as any;

      const result = await register(mockSupabase, {
        email: 'test@example.com',
        password: 'SecurePassword123!',
        name: 'Test Merchant',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already');
    });

    it('should reject weak passwords', async () => {
      const result = await register(mockSupabase, {
        email: 'test@example.com',
        password: '123',
        name: 'Test Merchant',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Password');
    });

    it('should reject invalid email format', async () => {
      const result = await register(mockSupabase, {
        email: 'invalid-email',
        password: 'SecurePassword123!',
        name: 'Test Merchant',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('email');
    });

    it('should handle database errors gracefully', async () => {
      const mockSelect = vi.fn().mockResolvedValue({
        data: null,
        error: null,
      });

      const mockInsert = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Database connection failed' },
      });

      mockSupabase.from = vi.fn(() => ({
        select: mockSelect,
        insert: mockInsert,
      })) as any;

      const result = await register(mockSupabase, {
        email: 'test@example.com',
        password: 'SecurePassword123!',
        name: 'Test Merchant',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('login', () => {
    it('should login with correct credentials', async () => {
      const mockPasswordHash = '$2a$12$hashedpassword';
      
      const mockSelect = vi.fn().mockResolvedValue({
        data: {
          id: 'merchant-123',
          email: 'test@example.com',
          password_hash: mockPasswordHash,
          name: 'Test Merchant',
        },
        error: null,
      });

      mockSupabase.from = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: mockSelect,
          })),
        })),
      })) as any;

      // Mock bcrypt verification
      vi.mock('bcryptjs', () => ({
        default: {
          compare: vi.fn().mockResolvedValue(true),
        },
      }));

      const result = await login(mockSupabase, {
        email: 'test@example.com',
        password: 'SecurePassword123!',
      });

      expect(result.success).toBe(true);
      expect(result.merchant).toBeDefined();
      expect(result.token).toBeDefined();
    });

    it('should reject login with non-existent email', async () => {
      const mockSelect = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Not found' },
      });

      mockSupabase.from = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: mockSelect,
          })),
        })),
      })) as any;

      const result = await login(mockSupabase, {
        email: 'nonexistent@example.com',
        password: 'SecurePassword123!',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid');
    });

    it('should reject login with incorrect password', async () => {
      // Mock password verification to return false
      vi.mocked(encryption.verifyPassword).mockResolvedValueOnce(false);
      
      mockSupabase.from = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'merchant-123',
                email: 'test@example.com',
                password_hash: '$2a$12$hashedpassword',
              },
              error: null,
            }),
          })),
        })),
      })) as any;

      const result = await login(mockSupabase, {
        email: 'test@example.com',
        password: 'WrongPassword123!',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid');
    });

    it('should validate email format', async () => {
      const result = await login(mockSupabase, {
        email: 'invalid-email',
        password: 'SecurePassword123!',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('email');
    });

    it('should require password', async () => {
      const result = await login(mockSupabase, {
        email: 'test@example.com',
        password: '',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('verifySession', () => {
    it('should verify valid token and return merchant', async () => {
      const mockSelect = vi.fn().mockResolvedValue({
        data: {
          id: 'merchant-123',
          email: 'test@example.com',
          name: 'Test Merchant',
        },
        error: null,
      });

      mockSupabase.from = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: mockSelect,
          })),
        })),
      })) as any;

      const result = await verifySession(mockSupabase, 'valid-token');

      expect(result.success).toBe(true);
      expect(result.merchant).toBeDefined();
    });

    it('should reject invalid token', async () => {
      const result = await verifySession(mockSupabase, 'invalid-token');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should reject expired token', async () => {
      // Mock JWT verification to throw expired error
      vi.mocked(jwt.verifyToken).mockImplementationOnce(() => {
        throw new Error('Token has expired');
      });
      
      const result = await verifySession(mockSupabase, 'expired-token');

      expect(result.success).toBe(false);
      expect(result.error).toContain('expired');
    });

    it('should handle merchant not found', async () => {
      const mockSelect = vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Not found' },
      });

      mockSupabase.from = vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: mockSelect,
          })),
        })),
      })) as any;

      const result = await verifySession(mockSupabase, 'valid-token-but-no-merchant');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});