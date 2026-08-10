import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockFrom = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}));

const mockVerifyToken = vi.fn();
vi.mock('@/lib/auth/jwt', () => ({
  verifyToken: (...args: unknown[]) => mockVerifyToken(...args),
}));

const mockAuthorizeBusiness = vi.fn();
vi.mock('@/lib/auth/authz', () => ({
  authorizeBusiness: (...args: unknown[]) => mockAuthorizeBusiness(...args),
}));

vi.mock('@/lib/secrets', () => ({
  getJwtSecret: vi.fn(() => 'test-secret'),
}));

import { DELETE, GET, PUT } from './route';

const params = { params: Promise.resolve({ id: 'client-1' }) };

function request(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/clients/client-1', {
    method,
    headers: {
      authorization: 'Bearer test-token',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function clientLookup(client: Record<string, unknown>) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: client, error: null }),
      }),
    }),
  };
}

describe('/api/clients/[id] team access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    mockVerifyToken.mockReturnValue({ userId: 'team-member-1' });
    mockAuthorizeBusiness.mockResolvedValue({ ok: true, role: 'writer' });
  });

  it('lets an authorized team member read a client owned by the business owner', async () => {
    const client = {
      id: 'client-1',
      business_id: 'business-1',
      user_id: 'business-owner-1',
      email: 'client@example.com',
    };
    mockFrom.mockReturnValue(clientLookup(client));

    const response = await GET(request('GET'), params);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, client });
    expect(mockAuthorizeBusiness).toHaveBeenCalledWith(
      expect.anything(),
      'team-member-1',
      'business-1',
      'business.read'
    );
  });

  it('lets a writer update a client after business authorization', async () => {
    const existingClient = { id: 'client-1', business_id: 'business-1' };
    const updatedClient = { ...existingClient, name: 'Updated Client' };
    const updateSingle = vi.fn().mockResolvedValue({ data: updatedClient, error: null });
    const updateSelect = vi.fn().mockReturnValue({ single: updateSingle });
    const updateBusinessEq = vi.fn().mockReturnValue({ select: updateSelect });
    const updateIdEq = vi.fn().mockReturnValue({ eq: updateBusinessEq });
    const table = {
      ...clientLookup(existingClient),
      update: vi.fn().mockReturnValue({ eq: updateIdEq }),
    };
    mockFrom.mockReturnValue(table);

    const response = await PUT(request('PUT', { name: 'Updated Client' }), params);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, client: updatedClient });
    expect(mockAuthorizeBusiness).toHaveBeenCalledWith(
      expect.anything(),
      'team-member-1',
      'business-1',
      'customer.write'
    );
    expect(updateBusinessEq).toHaveBeenCalledWith('business_id', 'business-1');
  });

  it('blocks a readonly member from deleting a client', async () => {
    const deleteTable = {
      ...clientLookup({ id: 'client-1', business_id: 'business-1' }),
      delete: vi.fn(),
    };
    mockFrom.mockReturnValue(deleteTable);
    mockAuthorizeBusiness.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Insufficient permissions',
    });

    const response = await DELETE(request('DELETE'), params);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'Insufficient permissions',
    });
    expect(deleteTable.delete).not.toHaveBeenCalled();
  });

  it('returns 401 instead of 500 for an invalid token', async () => {
    mockVerifyToken.mockImplementation(() => {
      throw new Error('invalid token');
    });

    const response = await GET(request('GET'), params);

    expect(response.status).toBe(401);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
