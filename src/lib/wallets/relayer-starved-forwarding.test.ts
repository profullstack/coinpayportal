import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  balance: vi.fn(), webhook: vi.fn(), tier: vi.fn(),
  relay: vi.fn(), topUp: vi.fn(), alert: vi.fn(),
  // A well-formed key, generated per run so it never reads as a committed credential.
  key: Array.from({ length: 32 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join(''),
}));
vi.mock('@/app/api/cron/monitor-payments/balance-checkers', () => ({ checkBalance: mocks.balance }));
vi.mock('@/lib/crypto/require-key', () => ({ tryRequireEncryptionKey: () => ({ ok: true, key: 'synthetic' }) }));
vi.mock('@/lib/crypto/encryption', () => ({ decrypt: () => mocks.key }));
// Per-address keys open through the operator vault (operator-keys.ts, own tests).
vi.mock('@/lib/wallets/operator-keys', () => ({
  openPaymentAddressKey: async () => mocks.key,
  OperatorKeysLockedError: class OperatorKeysLockedError extends Error {},
}));
vi.mock('@/lib/wallets/system-wallet', () => ({ getCommissionWallet: () => 'synthetic-fee' }));
vi.mock('@/lib/entitlements/service', () => ({ isBusinessPaidTier: mocks.tier }));
vi.mock('@/lib/webhooks/service', () => ({ sendPaymentWebhook: mocks.webhook }));
vi.mock('./relayer-health', () => ({ alertRelayerUnderfunded: mocks.alert }));
vi.mock('./evm-gas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./evm-gas')>();
  return { ...actual, forwardTokenViaRelayer: mocks.relay, ensureGasForTransfers: mocks.topUp };
});
vi.mock('@/lib/blockchain/providers', () => ({
  getProvider: () => ({}), getRpcUrl: () => 'http://localhost',
  EthereumProvider: class {}, SolanaProvider: class {}, BitcoinProvider: class {},
}));

import { RelayerUnderfundedError } from './evm-gas';
import { forwardPaymentSecurely } from './secure-forwarding';
import { settleForwardingMetadata } from '../payments/reconciliation';

const RELAYER = '0xA3c90BD23903C63242D6b3e0effB4E6C5583Eb6B';

function shortfall() {
  return new RelayerUnderfundedError({
    relayerAddress: RELAYER, cryptocurrency: 'USDC_POL',
    balanceWei: 0n, neededWei: 129775651433680000n, purpose: 'for USDC_POL',
  });
}

/** Just enough of PostgREST for forwardPaymentSecurely: conditional updates on one payment row. */
function database() {
  const payment: Record<string, unknown> = {
    id: 'synthetic-payment', business_id: 'synthetic-business', status: 'confirmed',
    blockchain: 'USDC_POL', crypto_amount: 15.013003, amount: 15,
    payment_address: 'synthetic-source', merchant_wallet_address: '0x' + '22'.repeat(20), metadata: { kind: 'new' },
  };
  const address = {
    payment_id: payment.id, address: payment.payment_address, cryptocurrency: 'USDC_POL',
    merchant_wallet: payment.merchant_wallet_address, commission_wallet: 'synthetic-fee',
    encrypted_private_key: 'synthetic-encrypted',
  };
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
          const match = filters.every(([key, value]) => payment[key] === value);
          if (match) Object.assign(payment, values);
          return Promise.resolve({ data: match ? [{ ...payment }] : [], error: null }).then(resolve, reject);
        }
        return Promise.resolve({ data: single ? { ...(table === 'payments' ? payment : address) } : [], error: null }).then(resolve, reject);
      },
    };
    return query;
  } };
  return { client: client as unknown as SupabaseClient, payment };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mocks.balance.mockResolvedValue(15.013003);
  mocks.tier.mockResolvedValue(false);
  mocks.alert.mockResolvedValue(true);
});

describe('a sweep stopped by an empty gas relayer', () => {
  it('goes back to confirmed, marked deferred, when the relayer pre-check fails', async () => {
    const db = database();
    mocks.relay.mockRejectedValueOnce(shortfall());

    const result = await forwardPaymentSecurely(db.client, 'synthetic-payment');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/deferred until the gas relayer is topped up/);
    expect(db.payment.status).toBe('confirmed');
    const metadata = db.payment.metadata as Record<string, any>;
    expect(metadata.kind).toBe('new');
    expect(metadata.reconciliation_required).toBeUndefined();
    expect(metadata.forwarding_deferred).toEqual(expect.objectContaining({
      reason: 'relayer_underfunded', relayer: RELAYER, chain: 'USDC_POL', balance_wei: '0',
    }));
    expect(mocks.topUp).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledWith(db.client, expect.any(RelayerUnderfundedError), 'synthetic-payment');
  });

  it('is deferred when a token without permit cannot be topped up', async () => {
    const db = database();
    mocks.relay.mockResolvedValueOnce(null);
    mocks.topUp.mockRejectedValueOnce(shortfall());

    await forwardPaymentSecurely(db.client, 'synthetic-payment');

    expect(db.payment.status).toBe('confirmed');
    expect((db.payment.metadata as any).forwarding_deferred.reason).toBe('relayer_underfunded');
  });

  it('stays held for reconciliation when the relayer path had already failed', async () => {
    // The relayer path can fail after its permit or a transferFrom landed, so a
    // shortfall on the fallback afterwards is not proof that nothing moved.
    const db = database();
    mocks.relay.mockRejectedValueOnce(new Error('transferFrom reverted paying 0x22 (0xabc)'));
    mocks.topUp.mockRejectedValueOnce(shortfall());

    const result = await forwardPaymentSecurely(db.client, 'synthetic-payment');

    expect(result.error).toMatch(/requires reconciliation/);
    expect(db.payment.status).toBe('forwarding');
    expect((db.payment.metadata as any).reconciliation_required).toBe(true);
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it('loses the deferral mark once a later forward succeeds', () => {
    const settled = settleForwardingMetadata({
      kind: 'new',
      forwarding_deferred: { reason: 'relayer_underfunded', relayer: RELAYER },
    }, '2026-10-14T06:00:00.000Z');
    expect(settled.changed).toBe(true);
    expect(settled.metadata).toEqual({ kind: 'new', reconciliation_resolved_at: '2026-10-14T06:00:00.000Z' });
  });
});
