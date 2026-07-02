import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { generateKeyPairSync, sign } from 'crypto';

// ── did:key helpers (mirror of route.ts, ed25519 multicodec 0xed01) ──

function base58btcEncode(bytes: Uint8Array): string {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let num = BigInt('0x' + Buffer.from(bytes).toString('hex'));
  const result: string[] = [];
  while (num > 0n) {
    result.unshift(ALPHABET[Number(num % 58n)]);
    num = num / 58n;
  }
  for (const b of bytes) {
    if (b === 0) result.unshift('1');
    else break;
  }
  return result.join('');
}

function deriveDidKey(pubRaw: Buffer): string {
  return `did:key:z${base58btcEncode(Buffer.concat([Buffer.from([0xed, 0x01]), pubRaw]))}`;
}

function edKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubRaw = Buffer.from(publicKey.export({ type: 'spki', format: 'der' })).subarray(-32);
  return { privateKey, pubRaw, pubB64url: Buffer.from(pubRaw).toString('base64url') };
}

// ── Mock state ─────────────────────────────────────────────────────

let mockAuthResult: { success: boolean; context?: unknown } = {
  success: true,
  context: { type: 'merchant', merchantId: 'merchant-123', email: 'test@test.com' },
};
let mockExistingDid: unknown = null;
let mockInsertResult: { data: unknown; error: unknown } = { data: null, error: null };
let mockInsertedData: unknown = null;

vi.mock('@/lib/auth/middleware', () => ({
  authenticateRequest: () => Promise.resolve(mockAuthResult),
  isMerchantAuth: (ctx: { type: string }) => ctx.type === 'merchant',
}));

vi.mock('@supabase/supabase-js', () => {
  const existingResult = () =>
    Promise.resolve({ data: mockExistingDid, error: mockExistingDid ? null : { code: 'PGRST116' } });
  const eqChain: any = {
    eq: () => eqChain,
    single: existingResult,
    maybeSingle: existingResult,
  };
  return {
    createClient: () => ({
      from: () => ({
        select: () => eqChain,
        insert: (data: unknown) => {
          mockInsertedData = data;
          return {
            select: () => ({
              single: () => Promise.resolve(mockInsertResult),
            }),
          };
        },
      }),
    }),
  };
});

// ── Helpers ────────────────────────────────────────────────────────

function makeRequest(body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/reputation/did/claim', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-api-key',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ── Tests ──────────────────────────────────────────────────────────

describe('POST /api/reputation/did/claim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    mockExistingDid = null;
    mockInsertedData = null;
    mockAuthResult = {
      success: true,
      context: { type: 'merchant', merchantId: 'merchant-123', email: 'test@test.com' },
    };
    mockInsertResult = {
      data: {
        did: 'did:key:z6MkTest',
        public_key: 'testpubkey',
        verified: true,
        created_at: '2026-01-01T00:00:00Z',
      },
      error: null,
    };
  });

  it('returns 401 when not authenticated', async () => {
    mockAuthResult = { success: false };
    const { POST } = await import('./route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns 409 when merchant already has a DID', async () => {
    mockExistingDid = { did: 'did:key:z6MkExisting', merchant_id: 'merchant-123' };
    const { POST } = await import('./route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain('already has a principal DID');
  });

  it('auto-generates did:key when no body provided', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.did).toMatch(/^did:key:z/);
    expect(json.public_key).toBeDefined();
    expect(json.verified).toBe(true);
  });

  it('stores merchant_id, did, public_key, and verified flag', async () => {
    const { POST } = await import('./route');
    await POST(makeRequest());

    expect(mockInsertedData).toMatchObject({
      merchant_id: 'merchant-123',
      verified: true,
    });
    expect((mockInsertedData as Record<string, unknown>).did).toMatch(/^did:key:z/);
    expect((mockInsertedData as Record<string, unknown>).public_key).toBeDefined();
  });

  it('returns 500 when DB insert fails', async () => {
    mockInsertResult = { data: null, error: { message: 'insert failed' } };
    const { POST } = await import('./route');
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
  });

  it('rejects a link whose did does not match the supplied public_key', async () => {
    // Attacker signs the claim message with their OWN key (so the signature is
    // valid) but supplies a did:key they do not own. Must be rejected.
    const { privateKey, pubB64url } = edKeypair();
    const victimDid = 'did:key:z6MkVictimNotOwnedByTheCaller';
    const signature = sign(
      null,
      Buffer.from(`claim-did:${victimDid}:merchant-123`),
      privateKey
    ).toString('base64url');

    const { POST } = await import('./route');
    const res = await POST(makeRequest({
      did: victimDid,
      public_key: pubB64url,
      signature,
      did_kind: 'agent',
    }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/did does not match/i);
  });

  it('links an existing DID when did matches the supplied public_key', async () => {
    const { privateKey, pubRaw, pubB64url } = edKeypair();
    const did = deriveDidKey(Buffer.from(pubRaw));
    const signature = sign(
      null,
      Buffer.from(`claim-did:${did}:merchant-123`),
      privateKey
    ).toString('base64url');
    mockInsertResult = {
      data: { did, public_key: pubB64url, verified: true, created_at: '2026-01-01T00:00:00Z' },
      error: null,
    };

    const { POST } = await import('./route');
    const res = await POST(makeRequest({
      did,
      public_key: pubB64url,
      signature,
      did_kind: 'agent',
    }));

    expect(res.status).toBe(201);
    expect((mockInsertedData as Record<string, unknown>).did).toBe(did);
  });
});
