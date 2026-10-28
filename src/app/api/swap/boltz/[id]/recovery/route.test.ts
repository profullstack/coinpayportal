import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { randomBytes } from 'crypto';
import { secp256k1 } from '@noble/curves/secp256k1';
import { encrypt } from '@/lib/crypto/encryption';
import { openWithWalletKey } from '@/lib/swap/sealed-keys';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const walletPriv = secp256k1.utils.randomSecretKey();
const WALLET_PRIV = hex(walletPriv);
const WALLET_PUB = hex(secp256k1.getPublicKey(walletPriv, true));
const LEGACY_KEY = randomBytes(32).toString('hex');
const SECRET = 'f'.repeat(20) + '0123456789abcdef0123456789abcdef0123456789ab';

let swapRow: Record<string, unknown> | null;
let walletRow: Record<string, unknown> | null;
let updates: Array<Record<string, unknown>>;

vi.mock('@/lib/web-wallet/auth', () => ({
  authenticateWalletRequest: () => Promise.resolve({ success: true, walletId: 'wallet-1' }),
}));
vi.mock('@/lib/web-wallet/rate-limit', () => ({
  checkRateLimitAsync: () => Promise.resolve({ allowed: true }),
}));
vi.mock('@/lib/audit/log', () => ({ recordAuditEvent: () => Promise.resolve() }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        single: () =>
          Promise.resolve({ data: table === 'swaps' ? swapRow : walletRow, error: null }),
        update: (data: Record<string, unknown>) => {
          updates.push(data);
          const u: any = { eq: () => u, then: (r: (v: unknown) => void) => r({ error: null }) };
          return u;
        },
      };
      return chain;
    },
  }),
}));

function req() {
  return new NextRequest('http://localhost/api/swap/boltz/swap-1/recovery', {
    headers: { authorization: 'Wallet sig' },
  });
}

beforeEach(() => {
  updates = [];
  walletRow = { public_key_secp256k1: WALLET_PUB };
  vi.stubEnv('ENCRYPTION_KEY', LEGACY_KEY);
});
afterEach(() => vi.unstubAllEnvs());

describe('GET /api/swap/boltz/:id/recovery', () => {
  it('migrates a legacy enc: row once and returns only sealed keys', async () => {
    swapRow = {
      id: 'swap-1',
      wallet_id: 'wallet-1',
      provider: 'boltz',
      status: 'swap.expired',
      provider_data: { direction: 'in', refundPrivateKey: `enc:${encrypt(SECRET, LEGACY_KEY)}` },
    };
    const { GET } = await import('./route');
    const res = await GET(req(), { params: Promise.resolve({ id: 'swap-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    const text = JSON.stringify(body);
    expect(text).not.toContain(SECRET);
    expect(body.refundPrivateKey).toBeUndefined();
    expect(updates).toHaveLength(1);
    expect(updates[0].seal_version).toBe(2);
    expect(JSON.stringify(updates[0])).not.toContain('enc:');
    expect(await openWithWalletKey(WALLET_PRIV, body.sealedRefundKey, body.aad.refund)).toBe(SECRET);
  });

  it('returns sealed keys without touching the row once sealed', async () => {
    swapRow = {
      id: 'swap-1',
      wallet_id: 'wallet-1',
      provider: 'boltz',
      status: 'swap.expired',
      provider_data: { direction: 'in', refundPrivateKey: `enc:${encrypt(SECRET, LEGACY_KEY)}` },
    };
    const { GET } = await import('./route');
    await GET(req(), { params: Promise.resolve({ id: 'swap-1' }) });
    swapRow = { ...swapRow, provider_data: updates[0].provider_data };
    updates = [];
    vi.stubEnv('ENCRYPTION_KEY', ''); // sealed rows need no server key at all
    const res = await GET(req(), { params: Promise.resolve({ id: 'swap-1' }) });
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(0);
    const body = await res.json();
    expect(await openWithWalletKey(WALLET_PRIV, body.sealedRefundKey, body.aad.refund)).toBe(SECRET);
  });

  it('refuses a legacy row after the cutoff and does not change it', async () => {
    vi.stubEnv('LEGACY_KEY_MIGRATION', 'off');
    swapRow = {
      id: 'swap-1',
      wallet_id: 'wallet-1',
      provider: 'boltz',
      status: 'x',
      provider_data: { refundPrivateKey: `enc:${encrypt(SECRET, LEGACY_KEY)}` },
    };
    const { GET } = await import('./route');
    const res = await GET(req(), { params: Promise.resolve({ id: 'swap-1' }) });
    expect(res.status).toBe(409);
    expect(updates).toHaveLength(0);
  });

  it('keeps legacy data when the wallet has no secp256k1 key', async () => {
    walletRow = { public_key_secp256k1: null };
    swapRow = {
      id: 'swap-1',
      wallet_id: 'wallet-1',
      provider: 'boltz',
      status: 'x',
      provider_data: { refundPrivateKey: `enc:${encrypt(SECRET, LEGACY_KEY)}` },
    };
    const { GET } = await import('./route');
    const res = await GET(req(), { params: Promise.resolve({ id: 'swap-1' }) });
    expect(res.status).toBe(409);
    expect(updates).toHaveLength(0);
    expect(JSON.stringify(await res.json())).not.toContain(SECRET);
  });
});
