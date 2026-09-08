import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ balance: vi.fn(), send: vi.fn(), provider: vi.fn(), webhook: vi.fn(), tier: vi.fn() }));
vi.mock('@/app/api/cron/monitor-payments/balance-checkers', () => ({ checkBalance: mocks.balance }));
vi.mock('@/lib/crypto/require-key', () => ({ tryRequireEncryptionKey: () => ({ ok: true, key: 'synthetic' }) }));
vi.mock('@/lib/crypto/encryption', () => ({ decrypt: () => 'synthetic-not-a-chain-key' }));
vi.mock('@/lib/wallets/system-wallet', () => ({ getCommissionWallet: () => 'synthetic-fee' }));
vi.mock('@/lib/entitlements/service', () => ({ isBusinessPaidTier: mocks.tier }));
vi.mock('@/lib/webhooks/service', () => ({ sendPaymentWebhook: mocks.webhook }));
vi.mock('@/lib/blockchain/providers', () => {
  class EthereumProvider {
    sendTransaction = mocks.send;
    sendSplitTransaction = mocks.send;
  }
  return { getProvider: mocks.provider, getRpcUrl: () => 'http://localhost',
    EthereumProvider, SolanaProvider: class {}, BitcoinProvider: class {} };
});
import { EthereumProvider } from '@/lib/blockchain/providers';
import { forwardPaymentSecurely, retryForwardingSecurely } from './secure-forwarding';

function database(options: { recoveryError?: boolean; competingStatus?: string; finalWriteError?: boolean; terminalRace?: string; reconciliationError?: boolean; reconciliationThrows?: boolean } = {}) {
  const payment: Record<string, unknown> = { id: 'synthetic-payment', business_id: 'synthetic-business',
    status: 'confirmed', blockchain: 'ETH', crypto_amount: 20, amount: 20,
    payment_address: 'synthetic-source', merchant_wallet_address: 'synthetic-merchant', metadata: {} };
  const address = { payment_id: payment.id, address: payment.payment_address, cryptocurrency: 'ETH',
    merchant_wallet: payment.merchant_wallet_address, commission_wallet: 'synthetic-fee',
    encrypted_private_key: 'synthetic-encrypted' };
  const writes: Array<Record<string, unknown>> = [];
  const client = { from(table: string) {
    let values: Record<string, unknown> | undefined;
    let single = false;
    const filters: Array<[string, unknown]> = [];
    const query = {
      select() { return query; }, update(patch: Record<string, unknown>) { values = patch; return query; },
      eq(key: string, value: unknown) { filters.push([key, value]); return query; },
      single() { single = true; return query; },
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        if (values && table === 'payments') {
          if (values.status === 'forwarded') {
            if (options.terminalRace) payment.status = options.terminalRace;
            if (options.finalWriteError) return Promise.resolve({ data: null, error: new Error('synthetic final write unavailable') }).then(resolve, reject);
          }
          if ((values.metadata as any)?.reconciliation_required) {
            if (options.reconciliationThrows) return Promise.reject(new Error('synthetic transport rejection')).then(resolve, reject);
            if (options.reconciliationError) return Promise.resolve({ data: null, error: new Error('synthetic metadata unavailable') }).then(resolve, reject);
          }
          if (values.status === 'confirmed') {
            if (options.competingStatus) payment.status = options.competingStatus;
            if (options.recoveryError) return Promise.resolve({ data: null, error: new Error('synthetic DB unavailable') }).then(resolve, reject);
          }
          const match = filters.every(([key, value]) => payment[key] === value);
          if (match) { Object.assign(payment, values); writes.push({ ...values }); }
          return Promise.resolve({ data: match ? [{ ...payment }] : [], error: null }).then(resolve, reject);
        }
        return Promise.resolve({ data: single ? { ...(table === 'payments' ? payment : address) } : [], error: null }).then(resolve, reject);
      },
    };
    return query;
  } };
  return { client: client as unknown as SupabaseClient, payment, writes };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No external network allowed'); }));
  mocks.balance.mockResolvedValue(20);
  mocks.tier.mockResolvedValue(false);
  mocks.send.mockResolvedValue('synthetic-tx-hash');
  mocks.webhook.mockResolvedValue({ success: true });
  mocks.provider.mockImplementation(() => new EthereumProvider('http://localhost'));
});

describe('ambiguous forwarding is held for reconciliation', () => {
  it.each([null, 'synthetic-existing-hash'])('never resets a legacy failure with hash %s for retry', async hash => {
    const db = database(); db.payment.status = 'forwarding_failed'; db.payment.forward_tx_hash = hash;
    const result = await retryForwardingSecurely(db.client, 'synthetic-payment');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/requires reconciliation/);
    expect(db.payment.status).toBe('forwarding_failed');
    expect(db.payment.forward_tx_hash).toBe(hash);
    expect(db.writes).toEqual([]);
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.balance).not.toHaveBeenCalled();
  });
  it('does not retry after a provider acknowledgement is lost', async () => {
    const db = database();
    mocks.send.mockRejectedValueOnce(new Error('synthetic acknowledgement lost after acceptance'));
    const result = await forwardPaymentSecurely(db.client, 'synthetic-payment');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/reconcil/i);
    expect(db.payment.status).toBe('forwarding');
    expect(db.payment.metadata).toEqual(expect.objectContaining({ reconciliation_required: true }));
    expect((await retryForwardingSecurely(db.client, 'synthetic-payment')).success).toBe(false);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it('keeps an accepted transfer held when the final database write fails', async () => {
    const db = database({ finalWriteError: true });
    expect((await forwardPaymentSecurely(db.client, 'synthetic-payment')).success).toBe(false);
    expect(db.payment.status).toBe('forwarding');
    expect(db.payment.forward_tx_hash).toBe('synthetic-tx-hash');
    expect((await retryForwardingSecurely(db.client, 'synthetic-payment')).success).toBe(false);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.webhook).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('requires reconciliation'), expect.objectContaining({ merchantTxHash: 'synthetic-tx-hash' }));
  });

  it('retains the first known leg hash when the second transfer fails', async () => {
    const db = database();
    mocks.provider.mockReturnValue({ sendTransaction: mocks.send });
    mocks.send.mockResolvedValueOnce('synthetic-merchant-hash').mockRejectedValueOnce(new Error('synthetic fee failure'));
    expect((await forwardPaymentSecurely(db.client, 'synthetic-payment')).success).toBe(false);
    expect(db.payment.status).toBe('forwarding');
    expect(db.payment.forward_tx_hash).toBe('synthetic-merchant-hash');
    expect(db.payment.metadata).toEqual(expect.objectContaining({
      reconciliation_required: true, forwarding_merchant_tx_hash: 'synthetic-merchant-hash',
    }));
    expect((await retryForwardingSecurely(db.client, 'synthetic-payment')).success).toBe(false);
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });

  it('keeps the claim even if error metadata cannot be persisted', async () => {
    const db = database({ reconciliationError: true });
    mocks.send.mockRejectedValueOnce(new Error('synthetic provider timeout'));
    expect((await forwardPaymentSecurely(db.client, 'synthetic-payment')).success).toBe(false);
    expect(db.payment.status).toBe('forwarding');
    expect((await retryForwardingSecurely(db.client, 'synthetic-payment')).success).toBe(false);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it('does not overwrite a concurrently changed terminal state', async () => {
    const db = database({ terminalRace: 'forwarded' });
    db.payment.forward_tx_hash = 'synthetic-other-worker-hash';
    expect((await forwardPaymentSecurely(db.client, 'synthetic-payment')).success).toBe(false);
    expect(db.payment.status).toBe('forwarded');
    expect(db.payment.forward_tx_hash).toBe('synthetic-other-worker-hash');
    expect(mocks.webhook).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('requires reconciliation'), expect.objectContaining({ merchantTxHash: 'synthetic-tx-hash' }));
  });

  it('notification failure cannot undo a successful transfer', async () => {
    const db = database(); mocks.webhook.mockRejectedValueOnce(new Error('synthetic notification failure'));
    expect((await forwardPaymentSecurely(db.client, 'synthetic-payment')).success).toBe(true);
    expect(db.payment.status).toBe('forwarded');
    expect(db.payment.forward_tx_hash).toBe('synthetic-tx-hash');
    expect((await retryForwardingSecurely(db.client, 'synthetic-payment')).success).toBe(false);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it('releases a pre-broadcast entitlement failure for a safe retry', async () => {
    const db = database(); mocks.tier.mockRejectedValueOnce(new Error('synthetic entitlement outage'));
    expect((await forwardPaymentSecurely(db.client, 'synthetic-payment')).success).toBe(false);
    expect(db.payment.status).toBe('confirmed');
    expect(mocks.send).not.toHaveBeenCalled();
    expect((await retryForwardingSecurely(db.client, 'synthetic-payment')).success).toBe(true);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it('releases a pre-broadcast provider initialization failure', async () => {
    const db = database(); mocks.provider.mockImplementationOnce(() => { throw new Error('synthetic configuration error'); });
    expect((await forwardPaymentSecurely(db.client, 'synthetic-payment')).success).toBe(false);
    expect(db.payment.status).toBe('confirmed');
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('does not invent successful hashes for a provider without transfer support', async () => {
    const db = database(); mocks.provider.mockReturnValue({});
    expect((await forwardPaymentSecurely(db.client, 'synthetic-payment')).success).toBe(false);
    expect(db.payment.status).toBe('confirmed');
    expect(db.payment.forward_tx_hash).toBeUndefined();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.webhook).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
    expect(mocks.balance).not.toHaveBeenCalled();
  });

  it('a thrown reconciliation write cannot release a post-broadcast claim', async () => {
    const db = database({ finalWriteError: true, reconciliationThrows: true });
    const result = await forwardPaymentSecurely(db.client, 'synthetic-payment');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/requires reconciliation before retry/);
    expect(db.payment.status).toBe('forwarding');
    expect(db.writes.some(write => write.status === 'confirmed')).toBe(false);
    expect((await retryForwardingSecurely(db.client, 'synthetic-payment')).success).toBe(false);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('requires reconciliation'), expect.objectContaining({ merchantTxHash: 'synthetic-tx-hash' }));
  });

  it.each([undefined, null, ''])('does not complete a transfer with missing provider hash %s', async hash => {
    const db = database(); mocks.send.mockResolvedValueOnce(hash);
    const result = await forwardPaymentSecurely(db.client, 'synthetic-payment');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/requires reconciliation/);
    expect(db.payment.status).toBe('forwarding');
    expect(db.writes.some(write => write.status === 'forwarded')).toBe(false);
    expect(mocks.webhook).not.toHaveBeenCalled();
    expect((await retryForwardingSecurely(db.client, 'synthetic-payment')).success).toBe(false);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('secure forwarding requires a known spendable balance', () => {
  it.each([null, undefined, NaN, Infinity, -Infinity, '20'])('never broadcasts for an invalid oracle value %s', async value => {
    const db = database(); mocks.balance.mockResolvedValue(value);
    const result = await forwardPaymentSecurely(db.client, 'synthetic-payment');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/balance/i);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.webhook).not.toHaveBeenCalled();
    expect(db.payment.status).toBe('confirmed');
  });
  it('defers a failed read then allows one verified retry', async () => {
    const db = database(); mocks.balance.mockRejectedValueOnce(new Error('synthetic timeout'));
    expect((await forwardPaymentSecurely(db.client, 'synthetic-payment')).success).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(db.payment.status).toBe('confirmed');
    expect((await forwardPaymentSecurely(db.client, 'synthetic-payment')).success).toBe(true);
    expect(db.payment.status).toBe('forwarded');
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect((await forwardPaymentSecurely(db.client, 'synthetic-payment')).success).toBe(false);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it('still refuses to broadcast if releasing its claim fails', async () => {
    const db = database({ recoveryError: true }); mocks.balance.mockRejectedValue(new Error('synthetic timeout'));
    const result = await forwardPaymentSecurely(db.client, 'synthetic-payment');
    expect(result.success).toBe(false);
    expect(db.payment.status).toBe('forwarding');
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.webhook).not.toHaveBeenCalled();
  });
  it('does not overwrite another worker when releasing a failed-read claim', async () => {
    const db = database({ competingStatus: 'forwarded' }); mocks.balance.mockRejectedValue(new Error('synthetic timeout'));
    expect((await forwardPaymentSecurely(db.client, 'synthetic-payment')).success).toBe(false);
    expect(db.payment.status).toBe('forwarded');
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it.each([0, -1, 19])('does not broadcast a known insufficient balance %s', async balance => {
    const db = database(); mocks.balance.mockResolvedValue(balance);
    expect((await forwardPaymentSecurely(db.client, 'synthetic-payment')).success).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(db.payment.status).toBe('confirmed');
  });
  it('splits the verified overpayment and preserves payout destinations', async () => {
    const db = database(); mocks.balance.mockResolvedValue(21);
    const result = await forwardPaymentSecurely(db.client, 'synthetic-payment');
    expect(result.success).toBe(true);
    expect(result.merchantAmount).toBe(20.79);
    expect(result.platformFee).toBe(0.21);
    expect(mocks.send.mock.calls[0][1]).toEqual([
      { address: 'synthetic-merchant', amount: '20.79' }, { address: 'synthetic-fee', amount: '0.21' },
    ]);
  });
});
