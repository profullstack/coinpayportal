import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ──────────────────────────────────────────────────────────

const mockFrom = vi.fn();
const mockSendEmail = vi.fn();

vi.mock('@/lib/supabase/service-client', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock('@/lib/email', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

import { POST } from './route';

// ── Helpers ────────────────────────────────────────────────────────

function makeRequest(headers: Record<string, string> = {}, query = '') {
  return new NextRequest(`http://localhost/api/cron/daily-stats${query}`, {
    method: 'POST',
    headers,
  });
}

type Result = { count?: number | null; data?: unknown[]; error?: unknown };

/**
 * A PostgREST-ish builder: every method chains, awaiting it yields `result`.
 * A `.range(a, b)` call returns the matching slice of `data`, so paging ends.
 */
function builder(result: Result) {
  let slice: [number, number] | null = null;
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'gte', 'not', 'in', 'order', 'limit']) {
    b[m] = vi.fn(() => b);
  }
  b.range = vi.fn((from: number, to: number) => {
    slice = [from, to];
    return b;
  });
  b.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
    const rows = result.data ?? [];
    return Promise.resolve({
      data: slice ? rows.slice(slice[0], slice[1] + 1) : rows,
      count: result.count === undefined ? null : result.count,
      error: result.error ?? null,
    }).then(resolve, reject);
  };
  return b;
}

/** Every table has `n` rows; `payments` rows carry a settled amount. */
function healthy(n = 7, overrides: Record<string, Result> = {}) {
  mockFrom.mockImplementation((table: string) => {
    if (overrides[table]) return builder(overrides[table]);
    if (table === 'payments') {
      return builder({ count: 3408, data: [{ id: 'p1', amount: '100.50', created_at: '2026-09-26T21:22:38Z' }] });
    }
    return builder({ count: n, data: [] });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CRON_SECRET', 'test-secret');
  vi.stubEnv('INTERNAL_API_KEY', '');
  mockSendEmail.mockResolvedValue({ success: true, messageId: 'email-1' });
});

// ════════════════════════════════════════════════════════════════════
//  POST /api/cron/daily-stats
// ════════════════════════════════════════════════════════════════════

describe('POST /api/cron/daily-stats', () => {
  it('returns 401 without a cron secret', async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns 401 with a wrong cron secret', async () => {
    const res = await POST(makeRequest({ 'x-cron-secret': 'wrong' }));
    expect(res.status).toBe(401);
  });

  it('returns 401 when CRON_SECRET is unset, even for an empty header', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const res = await POST(makeRequest({ authorization: 'Bearer ' }));
    expect(res.status).toBe(401);
  });

  it('sends the report with real counts to anthony@', async () => {
    healthy(446);

    const res = await POST(makeRequest({ authorization: 'Bearer test-secret' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.sent).toBe(true);
    expect(json.id).toBe('email-1');
    expect(json.subject).toContain('446 merchants');
    expect(json.subject).toContain('3408 payments');
    expect(json.subject).toContain('$100.50 settled');
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][0].to).toBe('anthony@profullstack.com');
    expect(mockSendEmail.mock.calls[0][0].from).toContain('@coinpayportal.com');
  });

  it('accepts the secret in x-cron-secret', async () => {
    healthy();
    const res = await POST(makeRequest({ 'x-cron-secret': 'test-secret' }));
    expect(res.status).toBe(200);
  });

  it('does NOT send, and returns 500, when a query errors (no silent zeros)', async () => {
    healthy(5, { wallet_transactions: { error: { message: 'TypeError: fetch failed' } } });

    const res = await POST(makeRequest({ 'x-cron-secret': 'test-secret' }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.sent).toBe(false);
    expect(json.error).toContain('wallet_transactions');
    expect(json.error).toContain('fetch failed');
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('does NOT send when the volume query hits a missing column', async () => {
    healthy(5, {
      payments: { count: 10, error: { message: 'column payments.amount_usd does not exist' } },
    });

    const res = await POST(makeRequest({ 'x-cron-secret': 'test-secret' }));
    expect(res.status).toBe(500);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('does NOT send when the merchants table reads zero (wrong database)', async () => {
    healthy(5, { merchants: { count: 0, data: [] } });

    const res = await POST(makeRequest({ 'x-cron-secret': 'test-secret' }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toContain('merchants');
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('does NOT send when a count comes back null', async () => {
    healthy(3, { invoices: { count: null, data: [] } });

    const res = await POST(makeRequest({ 'x-cron-secret': 'test-secret' }));
    expect(res.status).toBe(500);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('pages past 1000 rows when summing settled volume', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ id: `p${i}`, amount: '2' }));
    healthy(5, { payments: { count: 2500, data: rows } });

    const res = await POST(makeRequest({ 'x-cron-secret': 'test-secret' }, '?dry_run=1'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.stats.payments.settledUsd).toBe(5000);
  });

  it('dry_run=1 returns counts and sends nothing', async () => {
    healthy(12);

    const res = await POST(makeRequest({ 'x-cron-secret': 'test-secret' }, '?dry_run=1'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.dry_run).toBe(true);
    expect(json.stats.merchants.total).toBe(12);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('escapes signup-supplied names and emails in the HTML', async () => {
    healthy(4, {
      merchants: {
        count: 4,
        data: [{ id: 'm1', name: '<script>alert(1)</script>', email: '"><img src=x>@x.io', created_at: '2026-09-29T00:00:00Z' }],
      },
      businesses: {
        count: 4,
        data: [{ id: 'b1', name: '<a href="https://evil">Pay now</a>', created_at: '2026-09-29T00:00:00Z' }],
      },
    });

    const res = await POST(makeRequest({ 'x-cron-secret': 'test-secret' }));
    expect(res.status).toBe(200);
    const html: string = mockSendEmail.mock.calls[0][0].html;
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<img src=x>');
    expect(html).not.toContain('<a href="https://evil">');
  });

  it('returns 502 when the mailer rejects the send', async () => {
    healthy(9);
    mockSendEmail.mockResolvedValue({ success: false, error: 'domain not verified' });

    const res = await POST(makeRequest({ 'x-cron-secret': 'test-secret' }));
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.sent).toBe(false);
    expect(json.error).toContain('domain not verified');
  });
});
