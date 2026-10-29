/**
 * POST /api/escrow/:id/settle for token escrows (USDC/USDT).
 *
 * The escrow address holds the token, not the chain's native coin. These run
 * the route itself and check that every leg goes out through the token path,
 * never through the native-coin provider that used to send SOL/POL/ETH.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const sendTokenTransfers = vi.fn();
const nativeSend = vi.fn();
const nativeSplit = vi.fn();
const operatorAlert = vi.fn();

class FakeForwardNotStartedError extends Error {}
class FakeSolanaFeeShortfallError extends Error {}

vi.mock('@/lib/auth/secret-compare', () => ({ isInternalApiKey: (k: string) => k === 'internal-key' }));
vi.mock('@/lib/escrow', () => ({ markEscrowSettled: vi.fn() }));
vi.mock('@/lib/wallets/operator-keys', () => ({
  OperatorKeysLockedError: class extends Error {},
  openPaymentAddressKey: vi.fn(async () => 'escrow-private-key'),
  operatorAlert: (...args: unknown[]) => operatorAlert(...args),
}));
vi.mock('@/lib/blockchain/providers', () => ({
  getRpcUrl: (chain: string) => `rpc://${chain}`,
  getProvider: () => ({ sendTransaction: nativeSend, sendSplitTransaction: nativeSplit }),
}));
vi.mock('@/lib/wallets/secure-forwarding', () => ({
  isTokenTransferChain: (chain: string) => chain.startsWith('USDC') || chain.startsWith('USDT'),
  sendTokenTransfers: (...args: unknown[]) => sendTokenTransfers(...args),
  ForwardNotStartedError: FakeForwardNotStartedError,
  SolanaFeeShortfallError: FakeSolanaFeeShortfallError,
}));

let escrowRow: Record<string, unknown>;
const updates: Array<{ table: string; payload: Record<string, unknown> }> = [];
const inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];

function builder(table: string) {
  let op: 'select' | 'update' | 'insert' = 'select';
  let selectAfterUpdate = false;
  const result = () => {
    if (table === 'escrows' && op === 'select') return { data: escrowRow, error: null };
    if (table === 'escrows' && op === 'update' && selectAfterUpdate) return { data: [{ id: escrowRow.id }], error: null };
    if (table === 'payment_addresses' && op === 'select') {
      return { data: { id: 'addr-1', address: 'EscrowAddr111', commission_wallet: 'CommissionWallet111' }, error: null };
    }
    return { data: null, error: null };
  };
  const b: Record<string, unknown> = {
    select: () => { if (op === 'update') selectAfterUpdate = true; return b; },
    update: (payload: Record<string, unknown>) => { op = 'update'; updates.push({ table, payload }); return b; },
    insert: (payload: Record<string, unknown>) => { op = 'insert'; inserts.push({ table, payload }); return Promise.resolve({ data: null, error: null }); },
    eq: () => b,
    is: () => b,
    single: () => Promise.resolve(result()),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
  };
  return b;
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => builder(t) }) }));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';

const { POST } = await import('./route');

function settle(id: string, body?: unknown) {
  return POST(
    new NextRequest(`http://localhost/api/escrow/${id}/settle`, {
      method: 'POST',
      headers: { authorization: 'Bearer internal-key', 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }),
    { params: Promise.resolve({ id }) },
  );
}

function escrow(overrides: Record<string, unknown>) {
  return {
    id: 'esc-1',
    status: 'released',
    chain: 'USDC_SOL',
    amount: 10,
    deposited_amount: 10,
    fee_amount: 0.1,
    marketplace_fee_amount: 0.5,
    marketplace_fee_address: 'MarketplaceFee111',
    depositor_address: 'Depositor111',
    beneficiary_address: 'Beneficiary111',
    escrow_address_id: 'addr-1',
    settlement_tx_hash: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
  inserts.length = 0;
});

describe('escrow settle: token chains send the token', () => {
  it('releases USDC_SOL as SPL to the beneficiary, platform and marketplace in one call', async () => {
    escrowRow = escrow({});
    sendTokenTransfers.mockResolvedValue(['sig-1', 'sig-1', 'sig-1']);

    const res = await settle('esc-1');
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(nativeSend).not.toHaveBeenCalled();
    expect(nativeSplit).not.toHaveBeenCalled();
    expect(sendTokenTransfers).toHaveBeenCalledTimes(1);
    const [chain, rpc, key, legs] = sendTokenTransfers.mock.calls[0];
    expect(chain).toBe('USDC_SOL');
    expect(rpc).toBe('rpc://USDC_SOL');
    expect(key).toBe('escrow-private-key');
    expect(legs).toEqual([
      { address: 'Beneficiary111', amount: 9.4 },
      { address: 'CommissionWallet111', amount: 0.1 },
      { address: 'MarketplaceFee111', amount: 0.5 },
    ]);
    expect(json).toMatchObject({ success: true, status: 'settled', tx_hash: 'sig-1', fee_tx_hash: 'sig-1', marketplace_fee_tx_hash: 'sig-1' });
    const settled = updates.find((u) => u.table === 'escrows' && u.payload.status === 'settled');
    expect(settled?.payload).toMatchObject({ settlement_tx_hash: 'sig-1', fee_tx_hash: 'sig-1', marketplace_fee_tx_hash: 'sig-1' });
  });

  it('records a separate hash per leg on EVM chains', async () => {
    escrowRow = escrow({ chain: 'USDC_POL', beneficiary_address: '0xBeneficiary', marketplace_fee_address: '0xMarket' });
    sendTokenTransfers.mockResolvedValue(['0xbene', '0xplat', '0xmkt']);

    const json = await (await settle('esc-1')).json();

    expect(json).toMatchObject({ tx_hash: '0xbene', fee_tx_hash: '0xplat', marketplace_fee_tx_hash: '0xmkt' });
    expect(nativeSend).not.toHaveBeenCalled();
  });

  it('refunds USDC_ETH in full to the depositor as the token, with no fee legs', async () => {
    escrowRow = escrow({ chain: 'USDC_ETH', status: 'refunded', depositor_address: '0xDepositor' });
    sendTokenTransfers.mockResolvedValue(['0xrefund']);

    const res = await settle('esc-1', { action: 'refund' });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(sendTokenTransfers.mock.calls[0][3]).toEqual([{ address: '0xDepositor', amount: 10 }]);
    expect(json).toMatchObject({ status: 'refunded', tx_hash: '0xrefund' });
    expect(nativeSend).not.toHaveBeenCalled();
  });

  it('hands the claim back with 503 when the Solana fee payer is short, before anything is sent', async () => {
    escrowRow = escrow({});
    sendTokenTransfers.mockRejectedValue(new FakeSolanaFeeShortfallError('fee payer FeePayer111 has 0'));

    const res = await settle('esc-1');
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json.code).toBe('gas_unavailable');
    expect(updates.some((u) => u.table === 'escrows' && u.payload.settlement_started_at === null)).toBe(true);
    expect(updates.some((u) => u.payload.status === 'settled')).toBe(false);
    expect(operatorAlert).toHaveBeenCalled();
  });

  it('hands the claim back when the EVM gas relayer is underfunded', async () => {
    escrowRow = escrow({ chain: 'USDC_POL' });
    sendTokenTransfers.mockRejectedValue(new FakeForwardNotStartedError('relayer broke'));

    const res = await settle('esc-1');
    expect(res.status).toBe(503);
    expect(updates.some((u) => u.table === 'escrows' && u.payload.settlement_started_at === null)).toBe(true);
  });

  it('keeps the claim when a send fails after it may have broadcast', async () => {
    escrowRow = escrow({ chain: 'USDC_POL' });
    sendTokenTransfers.mockRejectedValue(new Error('transferFrom reverted paying 0xMarket (0xabc)'));

    const res = await settle('esc-1');
    expect(res.status).toBe(500);
    expect(updates.some((u) => u.table === 'escrows' && u.payload.settlement_started_at === null)).toBe(false);
    expect(updates.some((u) => u.payload.status === 'settled')).toBe(false);
  });

  it('refuses a beneficiary leg below one token unit instead of sending only the fees', async () => {
    escrowRow = escrow({ deposited_amount: 0.6000004, amount: 0.6000004, fee_amount: 0.1, marketplace_fee_amount: 0.5 });

    const res = await settle('esc-1');
    expect(res.status).toBe(500);
    expect(sendTokenTransfers).not.toHaveBeenCalled();
  });

  it('still settles native SOL through the chain provider', async () => {
    escrowRow = escrow({ chain: 'SOL', marketplace_fee_address: null, marketplace_fee_amount: 0 });
    nativeSplit.mockResolvedValue('native-sig');

    const json = await (await settle('esc-1')).json();

    expect(sendTokenTransfers).not.toHaveBeenCalled();
    expect(nativeSplit).toHaveBeenCalledTimes(1);
    expect(json.tx_hash).toBe('native-sig');
  });
});
