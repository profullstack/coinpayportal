import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { secp256k1 } from '@noble/curves/secp256k1';
import { openWithWalletKey, swapKeyAad } from '@/lib/swap/sealed-keys';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const walletPriv = secp256k1.utils.randomSecretKey();
const WALLET_PUB = hex(secp256k1.getPublicKey(walletPriv, true));
const REFUND_KEY = 'ab'.repeat(32);

let walletRow: Record<string, unknown> | null;
let inserted: Record<string, unknown> | null;
const createSwapIn = vi.fn();

vi.mock('@/lib/web-wallet/auth', () => ({
  authenticateWalletRequest: () => Promise.resolve({ success: true, walletId: 'wallet-1' }),
}));
vi.mock('@/lib/web-wallet/rate-limit', () => ({ checkRateLimitAsync: () => Promise.resolve({ allowed: true }) }));
vi.mock('@/lib/swap/boltz', () => ({
  getBoltzPairInfo: vi.fn(),
  createSwapOut: vi.fn(),
  estimateSwapFee: vi.fn(),
  createSwapIn: (...a: unknown[]) => createSwapIn(...a),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        single: () => Promise.resolve({ data: table === 'wallets' ? walletRow : null, error: null }),
        insert: (row: Record<string, unknown>) => {
          inserted = row;
          return Promise.resolve({ error: null });
        },
      };
      return chain;
    },
  }),
}));

const req = (body: unknown) =>
  new NextRequest('http://localhost/api/swap/boltz', {
    method: 'POST',
    headers: { authorization: 'Wallet sig', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  inserted = null;
  walletRow = { public_key_secp256k1: WALLET_PUB };
  createSwapIn.mockReset();
  createSwapIn.mockResolvedValue({ id: 'swap-9', address: 'bc1q', expectedAmount: 1000, bip21: 'bitcoin:bc1q', refundPrivateKey: REFUND_KEY });
});
afterEach(() => vi.unstubAllEnvs());

describe('POST /api/swap/boltz', () => {
  it('stores the refund key sealed to the wallet, with no ENCRYPTION_KEY configured', async () => {
    vi.stubEnv('ENCRYPTION_KEY', '');
    const { POST } = await import('./route');
    const res = await POST(req({ direction: 'in', invoice: 'lnbc1' }));
    expect(res.status).toBe(200);
    expect(inserted?.seal_version).toBe(2);
    const pd = inserted?.provider_data as Record<string, unknown>;
    expect(JSON.stringify(pd)).not.toContain(REFUND_KEY);
    expect(
      await openWithWalletKey(hex(walletPriv), pd.refundPrivateKey as string, swapKeyAad('wallet-1', 'swap-9', 'refundPrivateKey'))
    ).toBe(REFUND_KEY);
  });

  it('refuses before creating a Boltz swap when the wallet has no key to seal to', async () => {
    walletRow = { public_key_secp256k1: null };
    const { POST } = await import('./route');
    const res = await POST(req({ direction: 'in', invoice: 'lnbc1' }));
    expect(res.status).toBe(400);
    expect(createSwapIn).not.toHaveBeenCalled();
  });

  it('with a client-supplied refund public key, no private key is stored', async () => {
    createSwapIn.mockResolvedValue({ id: 'swap-9', address: 'bc1q', expectedAmount: 1000, bip21: 'bitcoin:bc1q' });
    const clientPub = hex(secp256k1.getPublicKey(secp256k1.utils.randomSecretKey(), true));
    const { POST } = await import('./route');
    const res = await POST(req({ direction: 'in', invoice: 'lnbc1', refundPublicKey: clientPub }));
    expect(res.status).toBe(200);
    expect(createSwapIn).toHaveBeenCalledWith('lnbc1', undefined, clientPub);
    const pd = inserted?.provider_data as Record<string, unknown>;
    expect(pd.refundPrivateKey).toBeUndefined();
    expect(pd.keyCustody).toBe('client');
  });

  it('rejects a malformed client public key', async () => {
    const { POST } = await import('./route');
    const res = await POST(req({ direction: 'in', invoice: 'lnbc1', refundPublicKey: 'zz' }));
    expect(res.status).toBe(400);
    expect(createSwapIn).not.toHaveBeenCalled();
  });
});
