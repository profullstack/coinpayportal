/**
 * Background service worker: the wiring no other test covers.
 *
 * The worker talks to `chrome.*` at module scope and to the portal over
 * `fetch`, so both are faked here and the module is imported fresh per test.
 * Requests go through the REAL `chrome.runtime.onMessage` listener — the same
 * entry point the popup uses — so these exercise the actual routing, not a
 * re-implementation of it.
 *
 * What matters most here is which BIP-44 account each portal call belongs to:
 * registering or signing under the wrong index is invisible in a unit test of
 * any single module, and it shipped once already.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import type { WalletRequest, WalletResponse } from '../../messages.js';

// Real signing needs real unsigned-tx bytes; the key it is handed is what
// matters here, and batch.test.ts covers the derivation itself.
vi.mock('../../core/signing.js', () => ({
  signTransaction: vi.fn(async () => ({ signed_tx: '0xsigned', format: 'hex' as const })),
}));

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'password123';

/** Minimal in-memory `browser.storage` area. */
function fakeArea() {
  const map = new Map<string, unknown>();
  return {
    map,
    async get(key: string) {
      return map.has(key) ? { [key]: map.get(key) } : {};
    },
    async set(items: Record<string, unknown>) {
      for (const [k, v] of Object.entries(items)) map.set(k, JSON.parse(JSON.stringify(v)));
    },
    async remove(key: string) {
      map.delete(key);
    },
    async clear() {
      map.clear();
    },
  };
}

interface Harness {
  send: (req: WalletRequest) => Promise<WalletResponse>;
  local: ReturnType<typeof fakeArea>;
  fetchMock: ReturnType<typeof vi.fn>;
  /** Bodies POSTed to /web-wallet/import, in order. */
  registrations: () => any[];
}

async function boot(options: { registerFails?: boolean } = {}): Promise<Harness> {
  const local = fakeArea();
  const session = fakeArea();
  let listener: ((req: any, sender: any, respond: (r: any) => void) => boolean) | null = null;

  const chrome = {
    storage: { local, session },
    alarms: { create: vi.fn(), clear: vi.fn(), onAlarm: { addListener: vi.fn() } },
    runtime: {
      onMessage: {
        addListener: (fn: any) => {
          listener = fn;
        },
      },
      sendMessage: vi.fn(async () => {}),
      getURL: (path: string) => `chrome-extension://test/${path}`,
    },
    windows: { create: vi.fn(async () => ({ id: 1 })), remove: vi.fn(async () => {}), onRemoved: { addListener: vi.fn() } },
    tabs: { sendMessage: vi.fn(async () => {}) },
  };

  const fetchMock = vi.fn(async (url: string, init: any) => {
    const path = String(url);
    if (path.endsWith('/web-wallet/import')) {
      if (options.registerFails) {
        return { ok: false, status: 503, json: async () => ({ success: false, error: { message: 'down' } }) };
      }
      const body = JSON.parse(init.body);
      // The portal keys a wallet by its public key — same key, same id.
      const walletId = `wallet-for-${body.public_key_secp256k1.slice(0, 12)}`;
      return { ok: true, status: 201, json: async () => ({ success: true, data: { wallet_id: walletId } }) };
    }
    if (path.includes('/prepare-tx')) {
      const body = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            tx_id: 'tx-1',
            chain: body.chain,
            from_address: body.from_address,
            to_address: body.to_address,
            amount: body.amount,
            fee: {},
            expires_at: new Date(Date.now() + 60_000).toISOString(),
            unsigned_tx: { chain: body.chain },
          },
        }),
      };
    }
    if (path.includes('/broadcast')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { tx_hash: '0xhash', chain: 'ETH', status: 'pending', explorer_url: 'https://x' },
        }),
      };
    }
    throw new Error(`unexpected fetch: ${path}`);
  });

  vi.stubGlobal('chrome', chrome);
  vi.stubGlobal('fetch', fetchMock);
  vi.resetModules();
  await import('../index.js');

  if (!listener) throw new Error('background worker registered no message listener');

  return {
    local,
    fetchMock,
    registrations: () =>
      fetchMock.mock.calls
        .filter(([url]) => String(url).endsWith('/web-wallet/import'))
        .map(([, init]) => JSON.parse((init as any).body)),
    send: (req) =>
      new Promise((resolve) => {
        listener!(req, {}, resolve);
      }),
  };
}

/** Registration is fire-and-forget; let its promise chain settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('portal registration on account creation', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await boot();
  });

  it('registers the wallet when one is imported', async () => {
    await h.send({ type: 'import', mnemonic: MNEMONIC, password: PASSWORD });
    await settle();

    expect(h.registrations()).toHaveLength(1);
    const [body] = h.registrations();
    expect(body.addresses.length).toBeGreaterThan(0);
    // Non-custodial: public material and a signature, never the seed.
    expect(JSON.stringify(body)).not.toContain('abandon');
    expect(body.proof_of_ownership.signature).toMatch(/^[0-9a-f]{128}$/);
  });

  it('registers a newly added account under its own index', async () => {
    await h.send({ type: 'import', mnemonic: MNEMONIC, password: PASSWORD });
    await settle();
    await h.send({ type: 'addAccount', label: 'Payouts' });
    await settle();

    const [first, second] = h.registrations();
    expect(h.registrations()).toHaveLength(2);
    // A separate account is a separate portal wallet: different key, different
    // addresses, and derivation paths that say so.
    expect(second.public_key_secp256k1).not.toBe(first.public_key_secp256k1);
    expect(second.addresses[0].address).not.toBe(first.addresses[0].address);
    expect(second.addresses.some((a: any) => a.derivation_path.includes('/1'))).toBe(true);
  });

  it('caches one portal wallet id per account', async () => {
    await h.send({ type: 'import', mnemonic: MNEMONIC, password: PASSWORD });
    await settle();
    await h.send({ type: 'addAccount' });
    await settle();

    const ids = h.local.map.get('portalWalletIds') as Record<string, string>;
    expect(Object.keys(ids).sort()).toEqual(['0', '1']);
    expect(ids['0']).not.toBe(ids['1']);
  });

  it('does not re-register an account it already knows', async () => {
    await h.send({ type: 'import', mnemonic: MNEMONIC, password: PASSWORD });
    await settle();
    await h.send({ type: 'lock' });
    await h.send({ type: 'unlock', password: PASSWORD });
    await settle();

    expect(h.registrations()).toHaveLength(1);
  });

  it('clears wallet ids from the previous seed on import', async () => {
    await h.send({ type: 'import', mnemonic: MNEMONIC, password: PASSWORD });
    await settle();
    // Stale ids from an earlier wallet: authenticating as them would prepare
    // transactions from addresses this seed cannot sign for.
    await h.local.set({ portalWalletId: 'legacy-id', portalWalletIds: { 0: 'stale', 5: 'stale' } });

    const other = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
    await h.send({ type: 'import', mnemonic: other, password: PASSWORD });
    await settle();

    expect(h.local.map.get('portalWalletId')).toBeUndefined();
    const ids = h.local.map.get('portalWalletIds') as Record<string, string>;
    expect(Object.values(ids ?? {})).not.toContain('stale');
  });

  it('drops the portal wallet id when an account is removed', async () => {
    await h.send({ type: 'import', mnemonic: MNEMONIC, password: PASSWORD });
    await settle();
    await h.send({ type: 'addAccount' });
    await settle();

    await h.send({ type: 'removeAccount', index: 1 });
    const ids = h.local.map.get('portalWalletIds') as Record<string, string>;
    expect(ids['1']).toBeUndefined();
    expect(ids['0']).toBeDefined();
  });
});

describe('registration failures never block the user', () => {
  it('still adds the account when the portal is down', async () => {
    const h = await boot({ registerFails: true });
    await h.send({ type: 'import', mnemonic: MNEMONIC, password: PASSWORD });
    await settle();

    const res = await h.send({ type: 'addAccount', label: 'Offline' });
    await settle();

    expect(res.ok).toBe(true);
    expect('walletAccounts' in res && res.walletAccounts).toHaveLength(2);
    // Nothing cached, so the send path will register on demand instead.
    expect(h.local.map.get('portalWalletIds') ?? {}).toEqual({});
  });

  it('reports the wallet as usable even though registration failed', async () => {
    const h = await boot({ registerFails: true });
    await h.send({ type: 'import', mnemonic: MNEMONIC, password: PASSWORD });
    await settle();

    const res = await h.send({ type: 'getState' });
    expect('state' in res && res.state).toMatchObject({ initialized: true, unlocked: true });
  });
});

describe('account switching', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await boot();
    await h.send({ type: 'import', mnemonic: MNEMONIC, password: PASSWORD });
    await settle();
  });

  it('serves the active account addresses', async () => {
    const before = await h.send({ type: 'getAccounts' });
    await h.send({ type: 'addAccount' });
    await settle();
    const after = await h.send({ type: 'getAccounts' });

    const addressOf = (r: WalletResponse) => ('accounts' in r ? r.accounts[0]!.address : '');
    expect(addressOf(after)).not.toBe(addressOf(before));

    await h.send({ type: 'selectAccount', index: 0 });
    expect(addressOf(await h.send({ type: 'getAccounts' }))).toBe(addressOf(before));
  });

  it('refuses to remove the only account', async () => {
    const res = await h.send({ type: 'removeAccount', index: 0 });
    expect(res.ok).toBe(false);
    expect('error' in res && res.error).toMatch(/only account/i);
  });

  it('falls back to a remaining account when the active one is removed', async () => {
    await h.send({ type: 'addAccount' });
    await settle();

    const res = await h.send({ type: 'removeAccount', index: 1 });
    expect('activeAccount' in res && res.activeAccount).toBe(0);
    expect('walletAccounts' in res && res.walletAccounts.map((a) => a.index)).toEqual([0]);
  });
});

/**
 * The bug that shipped in 0.4.0: the popup sent from the ACTIVE account while
 * the key and the portal wallet came from account 0. Every piece has to agree.
 */
describe('sending pays from the active account', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await boot();
    await h.send({ type: 'import', mnemonic: MNEMONIC, password: PASSWORD });
    await settle();
  });

  const prepareCalls = (h: Harness) =>
    h.fetchMock.mock.calls
      .filter(([url]) => String(url).includes('/prepare-tx'))
      .map(([url, init]) => ({ url: String(url), body: JSON.parse((init as any).body) }));

  it('spends from the active account address, under that account wallet id', async () => {
    const first = await h.send({ type: 'getAccounts' });
    const firstEth = 'accounts' in first ? first.accounts.find((a) => a.chain === 'ETH')!.address : '';

    await h.send({ type: 'addAccount' }); // index 1, now active
    await settle();
    const second = await h.send({ type: 'getAccounts' });
    const secondEth = 'accounts' in second ? second.accounts.find((a) => a.chain === 'ETH')!.address : '';

    const res = await h.send({ type: 'send', chain: 'ETH', to: '0xrecipient', amount: '0.01' });
    expect(res.ok).toBe(true);

    const [call] = prepareCalls(h);
    expect(call!.body.from_address).toBe(secondEth);
    expect(call!.body.from_address).not.toBe(firstEth);

    // ...and authenticated as the wallet registered for account 1, not 0.
    const ids = h.local.map.get('portalWalletIds') as Record<string, string>;
    expect(call!.url).toContain(ids['1']!);
    expect(call!.url).not.toContain(ids['0']!);
  });

  it('follows the user back to the first account', async () => {
    const first = await h.send({ type: 'getAccounts' });
    const firstEth = 'accounts' in first ? first.accounts.find((a) => a.chain === 'ETH')!.address : '';

    await h.send({ type: 'addAccount' });
    await settle();
    await h.send({ type: 'selectAccount', index: 0 });

    await h.send({ type: 'send', chain: 'ETH', to: '0xrecipient', amount: '0.01' });
    expect(prepareCalls(h)[0]!.body.from_address).toBe(firstEth);
  });

  it('registers on demand when creation-time registration failed', async () => {
    const offline = await boot({ registerFails: true });
    await offline.send({ type: 'import', mnemonic: MNEMONIC, password: PASSWORD });
    await settle();
    expect(offline.local.map.get('portalWalletIds') ?? {}).toEqual({});

    // The portal is reachable again by the time the user actually pays.
    offline.fetchMock.mockImplementation(async (url: string, init: any) => {
      if (String(url).endsWith('/web-wallet/import')) {
        const body = JSON.parse(init.body);
        return {
          ok: true,
          status: 201,
          json: async () => ({ success: true, data: { wallet_id: `w-${body.public_key_secp256k1.slice(0, 8)}` } }),
        };
      }
      if (String(url).includes('/prepare-tx')) {
        const body = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              tx_id: 'tx-1', chain: body.chain, from_address: body.from_address, to_address: body.to_address,
              amount: body.amount, fee: {}, expires_at: new Date(Date.now() + 60_000).toISOString(),
              unsigned_tx: { chain: body.chain },
            },
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { tx_hash: '0xh', chain: 'ETH', status: 'pending', explorer_url: 'x' } }),
      };
    });

    const res = await offline.send({ type: 'send', chain: 'ETH', to: '0xrecipient', amount: '0.01' });
    expect(res.ok).toBe(true);
    expect((offline.local.map.get('portalWalletIds') as Record<string, string>)['0']).toBeDefined();
  });
});

describe('settings round-trip', () => {
  it('defaults to USD and persists a chosen currency', async () => {
    const h = await boot();
    await h.send({ type: 'import', mnemonic: MNEMONIC, password: PASSWORD });

    const initial = await h.send({ type: 'getSettings' });
    expect('settings' in initial && initial.settings.fiatCurrency).toBe('USD');

    await h.send({ type: 'setFiatCurrency', currency: 'eur' });
    const after = await h.send({ type: 'getSettings' });
    expect('settings' in after && after.settings.fiatCurrency).toBe('EUR');
  });

  it('coerces an unsupported currency instead of storing it', async () => {
    const h = await boot();
    await h.send({ type: 'import', mnemonic: MNEMONIC, password: PASSWORD });

    await h.send({ type: 'setFiatCurrency', currency: 'DOGE' });
    const after = await h.send({ type: 'getSettings' });
    expect('settings' in after && after.settings.fiatCurrency).toBe('USD');
  });
});
