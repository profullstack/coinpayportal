import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryUsdAccountStore } from './store';
import { StubUsdAccountProvider, STUB_SIGNATURE_HEADER, signStubWebhook } from './stub';
import { ModernTreasuryProvider, MT_SIGNATURE_HEADER, parseMtEvent, toUsdAccount } from './modern-treasury';
import { hmacSha256Hex } from './signature';
import {
  getActiveUsdAccountProvider,
  getUsdAccountProvider,
  resetUsdAccountProviderRegistry,
  usdAccountsEnabled,
} from './providers';
import { getStatus, handleWebhook, requestAccount, foldDeposits, UsdAccountsError } from './service';
import { validateDestination } from './types';

const originalEnv = process.env;
const WALLET = '0x1111111111111111111111111111111111111111';
const SECRET = 'stub-secret';

function devEnv(extra: Record<string, string> = {}) {
  process.env = {
    ...originalEnv,
    NODE_ENV: 'test',
    USD_ACCOUNTS_ENABLED: '1',
    USD_ACCOUNTS_ENABLE_STUB: '1',
    USD_ACCOUNTS_STUB_WEBHOOK_SECRET: SECRET,
    ...extra,
  };
  delete process.env.MODERN_TREASURY_ORG_ID;
  delete process.env.MODERN_TREASURY_API_KEY;
  delete process.env.MODERN_TREASURY_WEBHOOK_KEY;
}

const input = {
  merchantId: 'm1',
  email: 'op@example.com',
  country: 'ng',
  destination: { asset: 'USDC' as const, chain: 'base' as const, address: WALLET },
};

function stubDelivery(body: Record<string, unknown>) {
  const raw = JSON.stringify(body);
  return { raw, headers: { [STUB_SIGNATURE_HEADER]: signStubWebhook(raw, SECRET) } };
}

let store: MemoryUsdAccountStore;
let stub: StubUsdAccountProvider;

beforeEach(() => {
  devEnv();
  resetUsdAccountProviderRegistry();
  store = new MemoryUsdAccountStore();
  stub = new StubUsdAccountProvider();
});

afterEach(() => {
  process.env = originalEnv;
  vi.restoreAllMocks();
});

describe('registry (dark by default)', () => {
  it('returns null when the master flag is off, even with the stub opted in', () => {
    delete process.env.USD_ACCOUNTS_ENABLED;
    expect(getActiveUsdAccountProvider()).toBeNull();
    expect(getUsdAccountProvider('stub')).toBeNull();
    expect(usdAccountsEnabled()).toBe(false);
  });

  it('returns null when the flag is on but nothing is configured', () => {
    delete process.env.USD_ACCOUNTS_ENABLE_STUB;
    expect(getActiveUsdAccountProvider()).toBeNull();
  });

  it('needs all three Modern Treasury keys plus the flag', () => {
    delete process.env.USD_ACCOUNTS_ENABLE_STUB;
    process.env.MODERN_TREASURY_ORG_ID = 'org';
    process.env.MODERN_TREASURY_API_KEY = 'key';
    expect(getActiveUsdAccountProvider()).toBeNull();
    process.env.MODERN_TREASURY_WEBHOOK_KEY = 'whk';
    expect(getActiveUsdAccountProvider()?.id).toBe('modern_treasury');
    delete process.env.USD_ACCOUNTS_ENABLED;
    expect(getActiveUsdAccountProvider()).toBeNull();
  });

  it('getStatus answers available:false with no provider', async () => {
    const view = await getStatus('m1', { store, provider: null });
    expect(view).toEqual({ available: false, provider: null, holder: null, account: null, deposits: [] });
  });

  it('requestAccount refuses with 503 with no provider', async () => {
    await expect(requestAccount(input, { store, provider: null })).rejects.toMatchObject({ status: 503 });
    expect(store.holders.size).toBe(0);
  });

  it('webhook answers 503 with no provider', async () => {
    delete process.env.USD_ACCOUNTS_ENABLED;
    const { raw, headers } = stubDelivery({ id: 'e1', type: 'holder.verified', holderId: 'x' });
    const outcome = await handleWebhook('stub', raw, headers, { store });
    expect(outcome.status).toBe(503);
    expect(store.events.size).toBe(0);
  });
});

describe('stub refuses in production', () => {
  it('is not configured and throws on use when NODE_ENV=production', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    expect(stub.isConfigured()).toBe(false);
    expect(getActiveUsdAccountProvider()).toBeNull();
    await expect(
      stub.createAccountHolder({ reference: 'r', email: 'a@b.c', country: 'NG', idempotencyKey: 'k' }),
    ).rejects.toThrow(/disabled/);
    const { raw, headers } = stubDelivery({ id: 'e1', type: 'holder.verified', holderId: 'x' });
    expect(stub.verifyAndParseWebhook(raw, headers).ok).toBe(false);
  });
});

describe('requestAccount', () => {
  it('refuses a country the partner does not support', async () => {
    await expect(requestAccount({ ...input, country: 'US' }, { store, provider: stub })).rejects.toMatchObject({
      status: 422,
    });
    await expect(requestAccount({ ...input, country: 'Nigeria' }, { store, provider: stub })).rejects.toMatchObject({
      status: 400,
    });
    expect(store.holders.size).toBe(0);
  });

  it('refuses a malformed destination', async () => {
    await expect(
      requestAccount({ ...input, destination: { ...input.destination, address: '0xnope' } }, { store, provider: stub }),
    ).rejects.toBeInstanceOf(UsdAccountsError);
  });

  it('is idempotent: a repeat returns the same holder and account', async () => {
    const createHolder = vi.spyOn(stub, 'createAccountHolder');
    const first = await requestAccount(input, { store, provider: stub });
    const second = await requestAccount(input, { store, provider: stub });
    expect(second.holder.id).toBe(first.holder.id);
    expect(second.account.id).toBe(first.account.id);
    expect(store.holders.size).toBe(1);
    expect(store.accounts.size).toBe(1);
    expect(createHolder).toHaveBeenCalledTimes(1);
    expect(first.holder.status).toBe('needs_action');
    expect(first.holder.onboarding_url).toMatch(/onboarding/);
    expect(first.account.status).toBe('requested');
  });

  it('two racing requests still produce one holder and one account', async () => {
    const [a, b] = await Promise.all([
      requestAccount(input, { store, provider: stub }),
      requestAccount(input, { store, provider: stub }),
    ]);
    expect(a.holder.id).toBe(b.holder.id);
    expect(store.holders.size).toBe(1);
    expect(store.accounts.size).toBe(1);
  });

  it('opens the account when the holder.verified webhook arrives, keeping only last4', async () => {
    const { holder } = await requestAccount(input, { store, provider: stub });
    stub.setHolderStatus(holder.provider_holder_id!, 'verified');
    const { raw, headers } = stubDelivery({ id: 'evt-1', type: 'holder.verified', holderId: holder.provider_holder_id });
    const outcome = await handleWebhook('stub', raw, headers, { store, provider: stub });
    expect(outcome).toEqual({ status: 200, body: { received: 1, duplicates: 0, ignored: 0 } });

    const account = [...store.accounts.values()][0];
    expect(account.status).toBe('open');
    expect(account.routing_number).toBe('011000015');
    expect(account.account_last4).toMatch(/^\d{4}$/);
    expect(JSON.stringify(account)).not.toMatch(/9000000000/);

    const view = await getStatus('m1', { store, provider: stub });
    expect(view.account?.accountNumber).toMatch(/^9000000000\d\d$/);
  });
});

describe('webhooks', () => {
  async function openAccount() {
    const { holder } = await requestAccount(input, { store, provider: stub });
    stub.setHolderStatus(holder.provider_holder_id!, 'verified');
    const d = stubDelivery({ id: 'evt-open', type: 'holder.verified', holderId: holder.provider_holder_id });
    await handleWebhook('stub', d.raw, d.headers, { store, provider: stub });
    return [...store.accounts.values()][0];
  }

  it('rejects a bad signature and records nothing', async () => {
    const raw = JSON.stringify({ id: 'e1', type: 'holder.verified', holderId: 'x' });
    const outcome = await handleWebhook('stub', raw, { [STUB_SIGNATURE_HEADER]: 'deadbeef' }, { store, provider: stub });
    expect(outcome.status).toBe(401);
    const tampered = await handleWebhook(
      'stub',
      raw.replace('x', 'y'),
      { [STUB_SIGNATURE_HEADER]: signStubWebhook(raw, SECRET) },
      { store, provider: stub },
    );
    expect(tampered.status).toBe(401);
    expect(store.events.size).toBe(0);
  });

  it('ignores a duplicate delivery of the same event id', async () => {
    const account = await openAccount();
    const d = stubDelivery({
      id: 'dep-evt-1',
      type: 'deposit.received',
      accountId: account.provider_account_id,
      depositId: 'dep-1',
      amountMinor: 125_00,
      rail: 'ach',
    });
    const first = await handleWebhook('stub', d.raw, d.headers, { store, provider: stub });
    const again = await handleWebhook('stub', d.raw, d.headers, { store, provider: stub });
    expect(first.body).toMatchObject({ received: 1, duplicates: 0 });
    expect(again.body).toMatchObject({ received: 0, duplicates: 1 });
    const deposits = (await getStatus('m1', { store, provider: stub })).deposits;
    expect(deposits).toHaveLength(1);
    expect(deposits[0]).toMatchObject({ depositId: 'dep-1', status: 'received', amountMinor: 12500 });
  });

  it('folds a deposit through to delivered', async () => {
    const account = await openAccount();
    for (const [i, type] of ['deposit.received', 'deposit.converted', 'deposit.delivered'].entries()) {
      const d = stubDelivery({
        id: `d-${i}`,
        type,
        accountId: account.provider_account_id,
        depositId: 'dep-9',
        amountMinor: 5000,
        txHash: type === 'deposit.delivered' ? '0xabc' : undefined,
      });
      await handleWebhook('stub', d.raw, d.headers, { store, provider: stub });
    }
    const [deposit] = (await getStatus('m1', { store, provider: stub })).deposits;
    expect(deposit).toMatchObject({ status: 'delivered', txHash: '0xabc' });
  });

  it('foldDeposits never lets an older event move a deposit backwards', () => {
    const base = {
      provider: 'stub', provider_type: 'x', merchant_id: 'm1', usd_account_id: 'a', provider_account_id: 'p',
      provider_holder_id: null, amount_minor: 100, currency: 'USD', rail: 'ach' as const,
      delivered_amount_atomic: null, delivered_asset: null, delivered_chain: null, tx_hash: null,
      return_code: null, occurred_at: null, payload: {}, provider_deposit_id: 'd',
    };
    const folded = foldDeposits([
      { ...base, id: '2', event_id: '2', event_type: 'deposit.received', received_at: '2026-01-02' },
      { ...base, id: '1', event_id: '1', event_type: 'deposit.delivered', received_at: '2026-01-01' },
    ]);
    expect(folded[0].status).toBe('delivered');
  });
});

describe('Modern Treasury adapter', () => {
  const mtEnv = () => {
    process.env.MODERN_TREASURY_ORG_ID = 'org_1';
    process.env.MODERN_TREASURY_API_KEY = 'key_1';
    process.env.MODERN_TREASURY_WEBHOOK_KEY = 'whk_1';
  };

  it('verifies X-Signature over the raw body and dedupes on X-Webhook-ID', () => {
    mtEnv();
    const mt = new ModernTreasuryProvider();
    const raw = JSON.stringify({ event: 'activated', data: { id: 'le_1', object: 'legal_entity', status: 'active' } });
    const good = mt.verifyAndParseWebhook(raw, {
      [MT_SIGNATURE_HEADER]: hmacSha256Hex(raw, 'whk_1'),
      'x-webhook-id': 'wh_1',
      'x-topic': 'legal_entity',
    });
    expect(good).toMatchObject({ ok: true, events: [{ type: 'holder.verified', holderId: 'le_1', eventId: 'wh_1' }] });
    expect(mt.verifyAndParseWebhook(raw, { [MT_SIGNATURE_HEADER]: hmacSha256Hex(raw, 'wrong'), 'x-webhook-id': 'w' }).ok).toBe(false);
    expect(mt.verifyAndParseWebhook(raw, { 'x-webhook-id': 'w' }).ok).toBe(false);
  });

  it('maps an incoming ACH credit to deposit.received in cents', () => {
    const event = parseMtEvent('wh_2', 'incoming_payment_detail', {
      event: 'completed',
      data: { id: 'ipd_1', direction: 'credit', currency: 'USD', amount: 250000, type: 'ach', internal_account_id: 'ia_usd' },
    });
    expect(event).toMatchObject({ type: 'deposit.received', accountId: 'ia_usd', depositId: 'ipd_1', amountMinor: 250000, rail: 'ach' });
  });

  it('maps a completed USDC stablecoin payment order to deposit.delivered', () => {
    const event = parseMtEvent('wh_3', 'payment_order', {
      event: 'completed',
      data: {
        id: 'po_1', type: 'stablecoin', currency: 'USDC', amount: 2500000000, originating_account_id: 'ia_usdc',
        metadata: { incoming_payment_detail_id: 'ipd_1' },
      },
    });
    expect(event).toMatchObject({
      type: 'deposit.delivered', accountId: 'ia_usdc', depositId: 'ipd_1', amountMinor: 250000,
      deliveredAmountAtomic: '2500000000', deliveredAsset: 'USDC',
    });
  });

  it('ignores USDC internal account activation (only the USD account is "the account")', () => {
    expect(parseMtEvent('w', 'internal_account', { event: 'activated', data: { id: 'ia', currency: 'USDC' } })).toBeNull();
    expect(
      parseMtEvent('w', 'internal_account', { event: 'account.activated', data: { id: 'ia', currency: 'USD' } }),
    ).toMatchObject({ type: 'account.opened' });
  });

  it('reads routing details and keeps the full number off the persisted fields', () => {
    const account = toUsdAccount({
      id: 'ia_usd',
      status: 'active',
      account_details: [{ account_number: '123456789012', account_number_safe: '9012', account_number_type: 'other' }],
      routing_details: [{ routing_number: '021000021', routing_number_type: 'aba', payment_type: 'ach', bank_name: 'Bank' }],
    });
    expect(account).toMatchObject({ status: 'open', routingNumber: '021000021', accountLast4: '9012', rails: ['ach'] });
  });

  it('sends HTTP Basic org:key and an Idempotency-Key', async () => {
    mtEnv();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const body = url.endsWith('/legal_entities')
        ? { id: 'le_1', status: 'draft' }
        : { hosted_url: 'https://payments.moderntreasury.com/flow/1' };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const mt = new ModernTreasuryProvider(fake);
    const holder = await mt.createAccountHolder({ reference: 'h1', email: 'a@b.c', country: 'KE', idempotencyKey: 'k1' });
    expect(holder).toMatchObject({ id: 'le_1', status: 'needs_action', onboardingUrl: 'https://payments.moderntreasury.com/flow/1' });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(calls[0].url).toBe('https://app.moderntreasury.com/api/legal_entities');
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('org_1:key_1').toString('base64')}`);
    expect(headers['Idempotency-Key']).toBe('k1:legal-entity');
  });
});

describe('validateDestination', () => {
  it('accepts EVM and Solana addresses on their chains only', () => {
    expect(validateDestination({ asset: 'USDC', chain: 'base', address: WALLET })).toBeNull();
    expect(
      validateDestination({ asset: 'USDC', chain: 'solana', address: '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV' }),
    ).toBeNull();
    expect(validateDestination({ asset: 'USDC', chain: 'solana', address: WALLET })).not.toBeNull();
    expect(validateDestination({ asset: 'USDT' as 'USDC', chain: 'base', address: WALLET })).not.toBeNull();
  });
});
