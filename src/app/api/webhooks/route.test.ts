import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

const { getWebhookLogsMock, singleMock, verifySessionMock } = vi.hoisted(() => ({
  getWebhookLogsMock: vi.fn(),
  singleMock: vi.fn(),
  verifySessionMock: vi.fn(),
}));

const supabaseMock = {
  from: vi.fn(() => supabaseMock),
  select: vi.fn(() => supabaseMock),
  eq: vi.fn(() => supabaseMock),
  single: singleMock,
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => supabaseMock),
}));

vi.mock('@/lib/auth/service', () => ({
  verifySession: verifySessionMock,
}));

vi.mock('@/lib/webhooks/service', () => ({
  getWebhookLogs: getWebhookLogsMock,
}));

function createRequest(query = '') {
  return new NextRequest(`http://localhost/api/webhooks${query}`, {
    headers: { Authorization: 'Bearer valid-token' },
  });
}

describe('GET /api/webhooks pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    verifySessionMock.mockResolvedValue({
      success: true,
      merchant: { id: 'merchant-123' },
    });
    singleMock.mockResolvedValue({
      data: { id: 'business-123' },
      error: null,
    });
    getWebhookLogsMock.mockResolvedValue({
      success: true,
      logs: [],
    });
  });

  it.each(['1.5', '10items', '+2', '-1', '0', '9007199254740992'])(
    'rejects invalid limit %s',
    async (limit) => {
      const response = await GET(
        createRequest(`?business_id=business-123&limit=${limit}`)
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        success: false,
        error: 'limit must be a positive integer',
      });
      expect(getWebhookLogsMock).not.toHaveBeenCalled();
    }
  );

  it.each(['1.5', '2rows', '+2', '-1', '9007199254740992'])(
    'rejects invalid offset %s',
    async (offset) => {
      const response = await GET(
        createRequest(`?business_id=business-123&offset=${offset}`)
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        success: false,
        error: 'offset must be a non-negative integer',
      });
      expect(getWebhookLogsMock).not.toHaveBeenCalled();
    }
  );

  it('passes valid integer pagination to the service', async () => {
    const response = await GET(
      createRequest('?business_id=business-123&limit=25&offset=0')
    );

    expect(response.status).toBe(200);
    expect(getWebhookLogsMock).toHaveBeenCalledWith(
      supabaseMock,
      'business-123',
      {
        payment_id: undefined,
        limit: 25,
        offset: 0,
      }
    );
  });

  it('keeps pagination optional', async () => {
    const response = await GET(
      createRequest('?business_id=business-123')
    );

    expect(response.status).toBe(200);
    expect(getWebhookLogsMock).toHaveBeenCalledWith(
      supabaseMock,
      'business-123',
      {
        payment_id: undefined,
        limit: undefined,
        offset: undefined,
      }
    );
  });
});
