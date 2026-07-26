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

async function boot(
  options: { registerFails?: boolean; storage?: Map<string, unknown> } = {},
): Promise<Harness> {
  const local = fakeArea();
  if (options.storage) for (const [k, v] of options.storage) local.map.set(k, v);
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

/**
 * Per-wallet keys live under `w:<id>:`. The first wallet is `w1`, so a
 * single-wallet install reads through this helper.
 */
const scoped = (h: Harness, key: string) => h.local.map.get(`w:w1:${key}`);

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

  it('registers a new address under the same wallet, at its own index', async () => {
    await h.send({ type: 'import', mnemonic: MNEMONIC, password: PASSWORD });
    await settle();
    await h.send({ type: 'addAddress', chain: 'SOL' });
    await settle();

    const [first, second] = h.registrations();
    expect(h.registrations()).toHaveLength(2);
    // One seed is ONE portal wallet: the identity key is the BIP-44 account
    // node, so it does not change per account. Registering an address-level key
    // instead created a second wallet row whose addresses then collided with
    // the first's and were dropped.
    expect(second.public_key_secp256k1).toBe(first.public_key_secp256k1);
    // The registration now carries more addresses than before.
    expect(second.addresses.length).toBeGreaterThan(first.addresses.length);
    // The new SOL address is registered at ITS index, on its own path.
    expect(second.addresses.some((a: any) => a.derivation_path.includes("501'/1'"))).toBe(true);
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

  it('caches one wallet for the seed, tracking which addresses it holds', async () => {
    await h.send({ type: 'import', mnemonic: MNEMONIC, password: PASSWORD });
    await settle();
    await h.send({ type: 'addAddress', chain: 'SOL' });
    await settle();

    const stored = scoped(h, 'portalWallet') as { id: string; fingerprint: string };
    expect(stored.id).toMatch(/^wallet-for-/);
    // The fingerprint lists every registered address, so a newly derived one
    // forces a re-register rather than going unknown to the portal.
    expect(stored.fingerprint).toContain('SOL:1');
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
    await h.local.set({
      'w:w1:portalWalletId': 'legacy-id',
      'w:w1:portalWalletIds': { 0: 'stale', 5: 'stale' },
    });

    const other = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
    await h.send({ type: 'import', mnemonic: other, password: PASSWORD });
    await settle();

    expect(scoped(h, 'portalWalletId')).toBeUndefined();
    expect(scoped(h, 'portalWalletIds')).toBeUndefined();
    const stored = scoped(h, 'portalWallet') as { id: string } | undefined;
    expect(stored?.id).not.toBe('stale');
  });

  it('derives a second address for a chain at that chain own next index', async () => {
    await h.send({ type: 'import', mnemonic: MNEMONIC, password: PASSWORD });
    await settle();

    const res = await h.send({ type: 'addAddress', chain: 'SOL' });
    expect('address' in res && res.address.index).toBe(1);
    // Each chain advances on its own: BTC must be untouched.
    const list = 'addresses' in res ? res.addresses : [];
    expect(list.filter((a) => a.chain === 'SOL')).toHaveLength(2);
    expect(list.filter((a) => a.chain === 'BTC')).toHaveLength(1);
  });
});

describe('registration failures never block the user', () => {
  it('still adds the account when the portal is down', async () => {
    const h = await boot({ registerFails: true });
    await h.send({ type: 'import', mnemonic: MNEMONIC, password: PASSWORD });
    await settle();

    const res = await h.send({ type: 'addAddress', chain: 'SOL' });
    await settle();

    expect(res.ok).toBe(true);
    expect('address' in res && res.address.index).toBe(1);
    // Nothing cached, so the send path will register on demand instead.
    expect(scoped(h, 'portalWallet')).toBeUndefined();
  });

  it('reports the wallet as usable even though registration failed', async () => {
    const h = await boot({ registerFails: true });
    await h.send({ type: 'import', mnemonic: MNEMONIC, password: PASSWORD });
    await settle();

    const res = await h.send({ type: 'getState' });
    expect('state' in res && res.state).toMatchObject({ initialized: true, unlocked: true });
  });
});


/**
 * The bug that shipped in 0.4.0: the popup sent from the ACTIVE account while
 * the key and the portal wallet came from account 0. Every piece has to agree.
 */
describe('sending pays from the chosen address', () => {
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

  it('spends from a chain first address by default', async () => {
    const list = await h.send({ type: 'listAddresses' });
    const eth = ('addresses' in list ? list.addresses : []).find((a) => a.chain === 'ETH')!;

    await h.send({ type: 'send', chain: 'ETH', to: '0xrecipient', amount: '0.01' });
    expect(prepareCalls(h)[0]!.body.from_address).toBe(eth.address);
  });

  it('spends from the address the user picked, signing at ITS index', async () => {
    const added = await h.send({ type: 'addAddress', chain: 'ETH' });
    await settle();
    const second = 'address' in added ? added.address : null;

    const res = await h.send({
      type: 'send',
      chain: 'ETH',
      to: '0xrecipient',
      amount: '0.01',
      from: second!.address,
    });

    expect(res.ok).toBe(true);
    expect(prepareCalls(h)[0]!.body.from_address).toBe(second!.address);
  });

  it('leaves other chains on their own index when one advances', async () => {
    // ETH on index 1, BTC still on 0 — a shared index would sign BTC with the
    // wrong key here.
    const added = await h.send({ type: 'addAddress', chain: 'ETH' });
    await settle();
    const ethSecond = 'address' in added ? added.address.address : '';

    await h.send({ type: 'send', chain: 'BTC', to: '1recipient', amount: '0.001' });
    const list = await h.send({ type: 'listAddresses' });
    const btc = ('addresses' in list ? list.addresses : []).find((a) => a.chain === 'BTC')!;

    expect(prepareCalls(h)[0]!.body.from_address).toBe(btc.address);
    expect(btc.address).not.toBe(ethSecond);
  });
});

describe('portal status and reset', () => {
  it('reports whether the portal knows this wallet', async () => {
    const h = await boot({ registerFails: true });
    await h.send({ type: 'import', mnemonic: MNEMONIC, password: PASSWORD });
    await settle();

    const before = await h.send({ type: 'getPortalStatus' });
    // Registration is per WALLET now — every address goes up together.
    expect('portal' in before && before.portal).toEqual([
      { index: 0, label: 'This wallet', walletId: null },
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
    expect(scoped(h, 'vault')).toBeDefined();

    const res = await h.send({ type: 'resetWallet' });
    expect('state' in res && res.state).toEqual({ initialized: false, unlocked: false });
    // Nothing of the old wallet may survive into the next one — but the wallet
    // list itself is global and stays.
    expect(scoped(h, 'vault')).toBeUndefined();
    expect(scoped(h, 'accountList')).toBeUndefined();
    expect(scoped(h, 'portalWallet')).toBeUndefined();

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

describe('several wallets, each with its own phrase', () => {
  const OTHER = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

  it('starts with one wallet', async () => {
    const h = await boot();
    const res = await h.send({ type: 'listWallets' });

    expect('wallets' in res && res.wallets).toEqual([
      { id: 'w1', label: 'Wallet 1', initialized: false },
    ]);
    expect('activeWallet' in res && res.activeWallet).toBe('w1');
  });

  it('keeps two phrases side by side, each with its own addresses', async () => {
    const h = await boot();
    await h.send({ type: 'import', mnemonic: MNEMONIC, password: PASSWORD });
    await settle();
    const first = await h.send({ type: 'getAccounts' });

    await h.send({ type: 'addWallet', label: 'Second' });
    await h.send({ type: 'import', mnemonic: OTHER, password: PASSWORD });
    await settle();
    const second = await h.send({ type: 'getAccounts' });

    const address = (r: WalletResponse) => ('accounts' in r ? r.accounts[0]!.address : '');
    expect(address(second)).not.toBe(address(first));

    // Switching back must restore the first wallet exactly, not a merge.
    await h.send({ type: 'selectWallet', id: 'w1' });
    expect(address(await h.send({ type: 'getAccounts' }))).toBe(address(first));
  });

  it('registers each wallet with the portal separately', async () => {
    const h = await boot();
    await h.send({ type: 'import', mnemonic: MNEMONIC, password: PASSWORD });
    await settle();
    await h.send({ type: 'addWallet' });
    await h.send({ type: 'import', mnemonic: OTHER, password: PASSWORD });
    await settle();

    const [first, second] = h.registrations();
    // Different seed, different identity key, different portal wallet.
    expect(second.public_key_secp256k1).not.toBe(first.public_key_secp256k1);
    expect(scoped(h, 'portalWallet')).not.toEqual(h.local.map.get('w:w2:portalWallet'));
  });

  it('does not let one wallet see another wallet vault', async () => {
    const h = await boot();
    await h.send({ type: 'import', mnemonic: MNEMONIC, password: PASSWORD });
    await h.send({ type: 'addWallet' });

    // The new wallet is empty until something is imported into it.
    const state = await h.send({ type: 'getState' });
    expect('state' in state && state.state.initialized).toBe(false);
    expect(h.local.map.get('w:w2:vault')).toBeUndefined();
    expect(scoped(h, 'vault')).toBeDefined();
  });

  it('removing a wallet leaves the other intact', async () => {
    const h = await boot();
    await h.send({ type: 'import', mnemonic: MNEMONIC, password: PASSWORD });
    await settle();
    await h.send({ type: 'addWallet' });
    await h.send({ type: 'import', mnemonic: OTHER, password: PASSWORD });
    await settle();

    const res = await h.send({ type: 'removeWallet', id: 'w2' });
    expect('wallets' in res && res.wallets.map((w) => w.id)).toEqual(['w1']);
    expect(h.local.map.get('w:w2:vault')).toBeUndefined();
    expect(scoped(h, 'vault')).toBeDefined();
  });

  it('refuses to remove the only wallet', async () => {
    const h = await boot();
    await h.send({ type: 'import', mnemonic: MNEMONIC, password: PASSWORD });

    const res = await h.send({ type: 'removeWallet', id: 'w1' });
    expect(res.ok).toBe(false);
    expect('error' in res && res.error).toMatch(/only wallet/i);
  });

  it('never reissues a removed wallet key space', async () => {
    const h = await boot();
    await h.send({ type: 'import', mnemonic: MNEMONIC, password: PASSWORD });
    await h.send({ type: 'addWallet' }); // w2
    await h.send({ type: 'removeWallet', id: 'w2' });
    await h.send({ type: 'addWallet' }); // must be w3, not w2

    const res = await h.send({ type: 'listWallets' });
    expect('wallets' in res && res.wallets.map((w) => w.id)).toEqual(['w1', 'w3']);
  });
});

describe('upgrading an existing single-wallet install', () => {
  it('moves the old keys under w1 and keeps the wallet usable', async () => {
    // Import on the pre-multi-wallet layout, then reboot into this version.
    const first = await boot();
    await first.send({ type: 'import', mnemonic: MNEMONIC, password: PASSWORD });
    await settle();
    const before = await first.send({ type: 'getAccounts' });

    // Simulate the old layout: unprefixed keys, no wallet list.
    const legacy = new Map(first.local.map);
    for (const [key, value] of legacy) {
      if (key.startsWith('w:w1:')) {
        first.local.map.set(key.slice('w:w1:'.length), value);
        first.local.map.delete(key);
      }
    }
    first.local.map.delete('walletList');
    first.local.map.delete('activeWallet');

    const rebooted = await boot({ storage: first.local.map });
    const after = await rebooted.send({ type: 'getAccounts' });

    const address = (r: WalletResponse) => ('accounts' in r ? r.accounts[0]!.address : '');
    expect(address(after)).toBe(address(before));
    expect(rebooted.local.map.get('vault')).toBeUndefined();
    expect(rebooted.local.map.get('w:w1:vault')).toBeDefined();
  });
});
