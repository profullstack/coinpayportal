import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

let row: { id: string; private_key_encrypted: string | null } | null;
let cleared = 0;

vi.mock('@/lib/auth/middleware', () => ({
  authenticateRequest: () =>
    Promise.resolve({ success: true, context: { type: 'merchant', merchantId: 'm-1' } }),
  isMerchantAuth: (c: { type: string }) => c.type === 'merchant',
}));
vi.mock('@/lib/audit/log', () => ({ recordAuditEvent: () => Promise.resolve() }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const sel: any = { eq: () => sel, maybeSingle: () => Promise.resolve({ data: row ? { ...row } : null }) };
      return {
        select: () => sel,
        update: (patch: { private_key_encrypted: null }) => {
          const filters: Record<string, unknown> = {};
          const u: any = {
            eq: (k: string, v: unknown) => {
              filters[k] = v;
              return u;
            },
            select: () => {
              const match = row && row.private_key_encrypted !== null && filters.private_key_encrypted === row.private_key_encrypted;
              if (match) {
                row!.private_key_encrypted = patch.private_key_encrypted;
                cleared++;
              }
              return Promise.resolve({ data: match ? [{ id: row!.id }] : [], error: null });
            },
          };
          return u;
        },
      };
    },
  }),
}));

const req = (body: unknown) =>
  new NextRequest('http://localhost/api/reputation/did/key-export', {
    method: 'POST',
    headers: { authorization: 'Bearer jwt', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  row = { id: 'd-1', private_key_encrypted: 'legacy-plaintext-key' };
  cleared = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe('POST /api/reputation/did/key-export', () => {
  it('returns the legacy key once and NULLs it in the same request', async () => {
    const { POST } = await import('./route');
    const first = await POST(req({ did: 'did:key:z1' }));
    expect(first.status).toBe(200);
    expect((await first.json()).private_key).toBe('legacy-plaintext-key');
    expect(row!.private_key_encrypted).toBeNull();
    expect(cleared).toBe(1);

    const second = await POST(req({ did: 'did:key:z1' }));
    expect(second.status).toBe(404);
  });

  it('is closed by LEGACY_KEY_MIGRATION=off and leaves the row alone', async () => {
    vi.stubEnv('LEGACY_KEY_MIGRATION', 'off');
    const { POST } = await import('./route');
    const res = await POST(req({ did: 'did:key:z1' }));
    expect(res.status).toBe(410);
    expect(row!.private_key_encrypted).toBe('legacy-plaintext-key');
  });

  it('requires a did', async () => {
    const { POST } = await import('./route');
    expect((await POST(req({}))).status).toBe(400);
  });
});
