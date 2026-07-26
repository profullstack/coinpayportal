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

  it('registers a new account under the same wallet, at its own index', async () => {
    await h.send({ type: 'import', mnemonic: MNEMONIC, password: PASSWORD });
    await settle();
    await h.send({ type: 'addAccount', label: 'Payouts' });
    await settle();

    const [first, second] = h.registrations();
    expect(h.registrations()).toHaveLength(2);
    // One seed is ONE portal wallet: the identity key is the BIP-44 account
    // node, so it does not change per account. Registering an address-level key
    // instead created a second wallet row whose addresses then collided with
    // the first's and were dropped.
    expect(second.public_key_secp256k1).toBe(first.public_key_secp256k1);
    // The addresses are the new account's, though, at its own index.
    expect(second.addresses[0].address).not.toBe(first.addresses[0].address);
    expect(second.addresses.some((a: any) => a.derivation_path.includes('/1'))).toBe(true);
  });

  it('registers the BIP-44 account node, not an address key', async () => {
    await h.send({ type: 'import', mnemonic: MNEMONIC, password: PASSWORD });
    await settle();

    const [body] = h.registrations();
    // Same value the CoinPay web wallet registers for this phrase, so both
    // clients resolve to one wallet. derivation.diff.test.ts pins the equality.
    expect(body.public_key_secp256k1).toMatch(/^0[23][0-9a-f]{64}$/);
    expect(body.addresses.every((a: any) => a.derivation_path.startsWith('m/44'))).toBe(true);
  });

  it('caches one wallet for the seed, tracking which accounts it holds', async () => {
    await h.send({ type: 'import', mnemonic: MNEMONIC, password: PASSWORD });
    await settle();
    await h.send({ type: 'addAccount' });
    await settle();

    const stored = h.local.map.get('portalWallet') as { id: string; accounts: number[] };
    expect(stored.id).toMatch(/^wallet-for-/);
    expect(stored.accounts.sort()).toEqual([0, 1]);
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
    expect(h.local.map.get('portalWalletIds')).toBeUndefined();
    const stored = h.local.map.get('portalWallet') as { id: string } | undefined;
    expect(stored?.id).not.toBe('stale');
  });

  it('drops a removed account from the registered set, keeping the wallet', async () => {
    await h.send({ type: 'import', mnemonic: MNEMONIC, password: PASSWORD });
    await settle();
    await h.send({ type: 'addAccount' });
    await settle();

    await h.send({ type: 'removeAccount', index: 1 });
    const stored = h.local.map.get('portalWallet') as { id: string; accounts: number[] };
    expect(stored.accounts).toEqual([0]);
    expect(stored.id).toMatch(/^wallet-for-/);
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
    expect(h.local.map.get('portalWallet')).toBeUndefined();
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

    // ...against the one wallet this seed owns, which now holds both accounts.
    const stored = h.local.map.get('portalWallet') as { id: string; accounts: number[] };
    expect(call!.url).toContain(stored.id);
    expect(stored.accounts.sort()).toEqual([0, 1]);
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
    expect(offline.local.map.get('portalWallet')).toBeUndefined();

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
    expect((offline.local.map.get('portalWallet') as { id: string }).id).toBeDefined();
  });
});

describe('portal status and reset', () => {
  it('reports which accounts the portal knows about', async () => {
    const h = await boot({ registerFails: true });
    await h.send({ type: 'import', mnemonic: MNEMONIC, password: PASSWORD });
    await settle();

    const before = await h.send({ type: 'getPortalStatus' });
    expect('portal' in before && before.portal).toEqual([
      { index: 0, label: 'Account 1', walletId: null },
    ]);
  });

  it('registers on demand and then reports the wallet id', async () => {
    const h = await boot();
    await h.send({ type: 'import', mnemonic: MNEMONIC, password: PASSWORD });
    await settle();

    const res = await h.send({ type: 'registerAccount', index: 0 });
    expect('portal' in res && res.portal[0]!.walletId).toMatch(/^wallet-for-/);
  });

  it('cannot register while locked', async () => {
    const h = await boot({ registerFails: true });
    await h.send({ type: 'import', mnemonic: MNEMONIC, password: PASSWORD });
    await settle();
    await h.send({ type: 'lock' });

    const res = await h.send({ type: 'registerAccount', index: 0 });
    expect(res.ok).toBe(false);
    expect('error' in res && res.error).toMatch(/locked/i);
  });

  it('reset erases the wallet so another phrase can be imported', async () => {
    const h = await boot();
    await h.send({ type: 'import', mnemonic: MNEMONIC, password: PASSWORD });
    await settle();
    expect(h.local.map.get('vault')).toBeDefined();

    const res = await h.send({ type: 'resetWallet' });
    expect('state' in res && res.state).toEqual({ initialized: false, unlocked: false });
    // Nothing of the old wallet may survive into the next one.
    expect(h.local.map.size).toBe(0);

    const other = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
    const reimported = await h.send({ type: 'import', mnemonic: other, password: PASSWORD });
    expect(reimported.ok).toBe(true);
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
