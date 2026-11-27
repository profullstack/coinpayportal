/**
 * Regression tests for the 2026-11-26 x402 facilitator disclosure:
 *
 *   CPP-01  Solana settlement accepted any SPL mint (and SPL for native SOL).
 *   CPP-02  An unconfirmed (0-conf, RBF-replaceable) Bitcoin tx settled as final.
 *   CPP-03  A payer-chosen `nonce` shadowed the real payment id, so one payment
 *           verified and settled once per nonce; and one EVM tx could settle
 *           several signed authorizations.
 *
 * Both routes run against one in-memory `x402_payments` table that enforces the
 * same unique indexes production has: (unique_key, network) and
 * (network, tx_hash).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, any>;
const table: Row[] = [];

function violatesUnique(candidate: Row, selfId?: string) {
  return table.some(
    (r) =>
      r.id !== selfId &&
      ((candidate.unique_key != null &&
        r.unique_key === candidate.unique_key &&
        r.network === candidate.network) ||
        (candidate.tx_hash != null && r.tx_hash === candidate.tx_hash && r.network === candidate.network)),
  );
}

function makeClient() {
  return {
    from(name: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let insertRow: Row | null = null;
      let patch: Row | null = null;
      let limit = Infinity;

      const exec = () => {
        if (name !== 'x402_payments') return { data: null, error: null };
        if (insertRow) {
          if (violatesUnique(insertRow)) return { data: null, error: { code: '23505', message: 'dup' } };
          const row = { id: `row-${table.length + 1}`, tx_hash: null, ...insertRow };
          table.push(row);
          return { data: [row], error: null };
        }
        const matched = table.filter((r) => filters.every((f) => f(r))).slice(0, limit);
        if (patch) {
          for (const r of matched) {
            if (violatesUnique({ ...r, ...patch }, r.id)) {
              return { data: null, error: { code: '23505', message: 'dup' } };
            }
          }
          matched.forEach((r) => Object.assign(r, patch));
        }
        return { data: matched, error: null };
      };

      const chain: any = {
        select: () => chain,
        insert: (row: Row) => ((insertRow = row), chain),
        update: (p: Row) => ((patch = p), chain),
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), chain),
        neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), chain),
        limit: (n: number) => ((limit = n), chain),
        single: async () => {
          const res = exec();
          if (res.error) return res;
          return res.data?.length === 1
            ? { data: res.data[0], error: null }
            : { data: null, error: { code: 'PGRST116', message: 'not single' } };
        },
        maybeSingle: async () => {
          const res = exec();
          return { data: res.data?.[0] ?? null, error: res.error };
        },
        then: (ok: any, bad: any) => Promise.resolve(exec()).then(ok, bad),
      };
      return chain;
    },
  };
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => makeClient() }));
vi.mock('@/lib/auth/scoped-keys', () => ({
  resolveScopedKey: vi.fn().mockResolvedValue({
    keyId: 'k1',
    business: { id: 'biz-1', merchant_id: 'm-1', name: 'Merchant', active: true },
    scopes: ['payments:create'],
  }),
  scopesSatisfy: (granted: string[], req: string) => granted.includes(req),
}));
vi.mock('@/lib/web-wallet/rate-limit', () => ({
  checkRateLimitAsync: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock('@/lib/entitlements/service', () => ({ isBusinessPaidTier: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/payments/fees', () => ({
  splitTieredPayment: vi.fn((amount: number) => ({
    merchantAmount: amount * 0.995,
    platformFee: amount * 0.005,
    feePercentage: 0.005,
  })),
}));

// EVM settlement reads the chain through ethers' JsonRpcProvider. Every tx
// hash resolves to the same successful USDC transfer to the merchant.
const EVM_MERCHANT = '0x1111111111111111111111111111111111111111';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
vi.mock('ethers', async (importOriginal) => {
  const actual: any = await importOriginal();
  class FakeProvider {
    async getTransactionReceipt() {
      return {
        status: 1,
        logs: [
          {
            address: USDC_BASE,
            topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              '0x' + '0'.repeat(64),
              '0x' + '0'.repeat(24) + EVM_MERCHANT.slice(2),
            ],
            data: '0x' + (1_000_000).toString(16).padStart(64, '0'),
          },
        ],
      };
    }
    async getTransaction() {
      return { to: USDC_BASE, value: 0n };
    }
  }
  return { ...actual, ethers: { ...actual.ethers, JsonRpcProvider: FakeProvider } };
});

const { POST: verifyPOST } = await import('../verify/route');
const { POST: settlePOST } = await import('./route');

function req(path: string, body: unknown) {
  return new NextRequest(`http://localhost/api/x402/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'cp_live_test' },
    body: JSON.stringify(body),
  });
}

const MERCHANT = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const BUYER = '4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const FAKE_MINT = 'FakeMint11111111111111111111111111111111111';
const RESOURCE = 'https://merchant.example/api/data';

function solanaRpc(meta: Record<string, unknown>, accountKeys = [BUYER, MERCHANT, 'MerchantAta111']) {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', id: 1, result: { transaction: { message: { accountKeys } }, meta: { err: null, ...meta } } }),
    { status: 200 },
  );
}

async function verifySolana(txSignature: string, amount: string, asset?: string, extra: Record<string, unknown> = {}) {
  return verifyPOST(
    req('verify', {
      payment: {
        payload: { scheme: 'exact', network: 'solana', txSignature, from: BUYER, to: MERCHANT, amount, asset, resource: RESOURCE, ...extra },
      },
      expected: { amount, payTo: MERCHANT, asset, resource: RESOURCE },
    }),
  );
}

beforeEach(() => {
  table.length = 0;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  process.env.SOLANA_RPC_URL = 'https://solana-rpc.local';
});
afterEach(() => vi.restoreAllMocks());

describe('CPP-01: Solana settlement is pinned to the verified asset', () => {
  it('refuses a USDC order paid in an unrelated SPL mint', async () => {
    expect((await verifySolana('sigFake', '500000000', USDC_MINT)).status).toBe(200);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      solanaRpc({
        preBalances: [10_000_000, 2_039_280, 2_039_280],
        postBalances: [9_995_000, 2_039_280, 2_039_280],
        preTokenBalances: [],
        postTokenBalances: [{ accountIndex: 2, mint: FAKE_MINT, owner: MERCHANT, uiTokenAmount: { amount: '500000000' } }],
      }),
    );
    const res = await settlePOST(req('settle', { payment: { payload: { scheme: 'exact', network: 'solana', txSignature: 'sigFake' } } }));
    expect(res.status).toBe(500);
    expect((await res.json()).details).toContain(`mint ${USDC_MINT}`);
    expect(table[0].status).toBe('settlement_failed');
  });

  it('settles a USDC order paid in USDC, also when the asset is named by symbol', async () => {
    for (const [sig, asset] of [['sigA', USDC_MINT], ['sigB', 'USDC']] as const) {
      expect((await verifySolana(sig, '500000000', asset)).status).toBe(200);
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        solanaRpc({
          preBalances: [1, 1, 1],
          postBalances: [1, 1, 1],
          preTokenBalances: [{ accountIndex: 2, mint: USDC_MINT, owner: MERCHANT, uiTokenAmount: { amount: '7' } }],
          postTokenBalances: [{ accountIndex: 2, mint: USDC_MINT, owner: MERCHANT, uiTokenAmount: { amount: '500000007' } }],
        }),
      );
      const res = await settlePOST(req('settle', { payment: { payload: { scheme: 'exact', network: 'solana', txSignature: sig } } }));
      expect(res.status).toBe(200);
      expect((await res.json()).settled).toBe(true);
    }
  });

  it('refuses a native SOL order paid only in SPL tokens', async () => {
    expect((await verifySolana('sigSol', '10000000000')).status).toBe(200);
    expect(table[0].asset).toBe('solana');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      solanaRpc({
        preBalances: [1, 5, 1],
        postBalances: [1, 5, 1],
        preTokenBalances: [],
        postTokenBalances: [{ accountIndex: 2, mint: FAKE_MINT, owner: MERCHANT, uiTokenAmount: { amount: '10000000000' } }],
      }),
    );
    const res = await settlePOST(req('settle', { payment: { payload: { scheme: 'exact', network: 'solana', txSignature: 'sigSol' } } }));
    expect(res.status).toBe(500);
    expect((await res.json()).details).toContain('lamports');
  });
});

describe('CPP-02: an unconfirmed Bitcoin transaction is not final', () => {
  const BTC_PAYEE = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
  const TXID = 'ab'.repeat(32);

  beforeEach(() => {
    table.push({
      id: 'btc-1', business_id: 'biz-1', network: 'bitcoin', scheme: 'exact', asset: 'bitcoin',
      to_address: BTC_PAYEE, amount: '250000', unique_key: TXID, status: 'verified', tx_hash: null,
    });
  });

  const mempool = (confirmed: boolean) =>
    new Response(
      JSON.stringify({
        txid: TXID,
        vout: [{ scriptpubkey_address: BTC_PAYEE, value: 250000 }],
        status: confirmed ? { confirmed: true, block_height: 900000 } : { confirmed: false },
      }),
      { status: 200 },
    );
  const settle = () => settlePOST(req('settle', { payment: { payload: { scheme: 'exact', network: 'bitcoin', txId: TXID } } }));

  it('records a mempool tx as pending_confirmation, then settles it once confirmed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mempool(false));
    let res = await settle();
    let body = await res.json();
    expect(res.status).toBe(200);
    expect(body.settled).toBe(false);
    expect(body.status).toBe('pending_confirmation');
    expect(table[0].status).toBe('pending_confirmation');
    expect(table[0].settled_at).toBeNull();

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mempool(true));
    res = await settle();
    body = await res.json();
    expect(res.status).toBe(200);
    expect(body.settled).toBe(true);
    expect(table[0].status).toBe('settled');
  });
});

describe('CPP-03: one payment settles one ledger row', () => {
  it('a rotated payload.nonce does not create a second Solana row for the same tx', async () => {
    expect((await verifySolana('sigOnce', '100000000', undefined, { nonce: 'client-nonce-1' })).status).toBe(200);
    const second = await verifySolana('sigOnce', '100000000', undefined, { nonce: 'client-nonce-2' });
    expect(second.status).toBe(400);
    expect((await second.json()).error).toContain('replay');
    expect(table).toHaveLength(1);
    expect(table[0].unique_key).toBe('sigOnce');
  });

  it('a Bitcoin key ignores nonce and txId case', async () => {
    const TX = 'CD'.repeat(32);
    const verifyBtc = (txId: string, nonce: string) =>
      verifyPOST(
        req('verify', {
          payment: { payload: { scheme: 'exact', network: 'bitcoin', txId, nonce, from: 'x', to: 'bc1qpayee', amount: '1000', resource: RESOURCE } },
          expected: { amount: '1000', payTo: 'bc1qpayee', resource: RESOURCE },
        }),
      );
    expect((await verifyBtc(TX, 'n1')).status).toBe(200);
    expect((await verifyBtc(TX.toLowerCase(), 'n2')).status).toBe(400);
  });

  it('one EVM transaction cannot settle two signed authorizations', async () => {
    const base = {
      business_id: 'biz-1', network: 'base', scheme: 'exact', asset: USDC_BASE,
      to_address: EVM_MERCHANT, amount: '1000000', status: 'verified', tx_hash: null,
    };
    table.push({ id: 'evm-1', unique_key: '1', ...base }, { id: 'evm-2', unique_key: '2', ...base });
    const TX = '0x' + 'Ee'.repeat(32);
    const settle = (nonce: string, txHash: string) =>
      settlePOST(req('settle', { payment: { payload: { scheme: 'exact', network: 'base', nonce, txHash } } }));

    const first = await settle('1', TX);
    expect(first.status).toBe(200);
    expect(table[0].tx_hash).toBe(TX.toLowerCase());

    // Same transaction, different casing, second authorization.
    const second = await settle('2', TX.toUpperCase().replace('0X', '0x'));
    expect(second.status).toBe(409);
    expect(table[1].status).toBe('settlement_failed');
    expect(table.filter((r) => r.status === 'settled')).toHaveLength(1);
  });
});
