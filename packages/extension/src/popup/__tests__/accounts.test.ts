// @vitest-environment jsdom
/**
 * The account bar.
 *
 * Dismissing "Add account" used to create one anyway, so a user who opened the
 * prompt out of curiosity ended up with an "Account 2" they never asked for and
 * (before removal existed) could not get rid of.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const call = vi.fn();
const dialogPrompt = vi.fn();
const dialogConfirm = vi.fn();
const dialogAlert = vi.fn(async (_opts?: unknown) => {});

vi.mock('../rpc.js', () => ({ call: (req: unknown) => call(req) }));
vi.mock('../dialog.js', () => ({
  dialogPrompt: (o: unknown) => dialogPrompt(o),
  dialogConfirm: (o: unknown) => dialogConfirm(o),
  dialogAlert: (o: unknown) => dialogAlert(o),
}));

const { start } = await import('../app.js');

/** Wallet unlocked, with two accounts so Remove is offered. */
function stubWallet() {
  call.mockImplementation(async (req: any) => {
    switch (req.type) {
      case 'getState':
        return { ok: true, state: { initialized: true, unlocked: true } };
      case 'getAccounts':
        return {
          ok: true,
          accounts: [
            { chain: 'ETH', address: '0xabc', tokens: ['USDC'] },
            { chain: 'BTC', address: '1abc', tokens: [] },
          ],
        };
      case 'listAccounts':
        return {
          ok: true,
          walletAccounts: [
            { index: 0, label: 'Account 1' },
            { index: 1, label: 'test' },
          ],
          activeAccount: 1,
        };
      case 'getSettings':
        return { ok: true, settings: { autoLockMinutes: 15, fiatCurrency: 'USD' } };
      case 'listConnections':
        return { ok: true, connections: [] };
      case 'getRate':
        return { ok: true, quote: { coin: req.coin, fiat: 'USD', rate: 2, fetchedAt: 0 } };
      case 'getBalances':
        return {
          ok: true,
          balances: [
            { chain: 'ETH', address: '0xabc', balance: '0.0113' },
            { chain: 'USDC_ETH', address: '0xabc', balance: '20' },
            { chain: 'USDC_BASE', address: '0xabc', balance: '20' },
            { chain: 'BTC', address: '1abc', balance: '0' },
            // On the wallet but not derivable by this extension yet.
            { chain: 'DOGE', address: 'DPsNhvo', balance: '5', derived: false },
          ],
        };
      default:
        return { ok: true };
    }
  });
}

const clicked = (text: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent === text);

/** Let the render's awaited RPCs settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  document.body.innerHTML = '<div id="app"></div><footer id="footer"></footer>';
  vi.stubGlobal('chrome', { runtime: { getManifest: () => ({ version: '0.4.2' }) } });
  call.mockReset();
  dialogPrompt.mockReset();
  dialogConfirm.mockReset();
  stubWallet();
  await start();
  await settle();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('add account', () => {
  it('creates nothing when the prompt is dismissed', async () => {
    dialogPrompt.mockResolvedValue(null); // Cancel / Escape
    clicked('+ Add')!.click();
    await settle();

    expect(call.mock.calls.map(([r]) => r.type)).not.toContain('addAccount');
  });

  it('creates the account when a name is given', async () => {
    dialogPrompt.mockResolvedValue('Payouts');
    clicked('+ Add')!.click();
    await settle();

    expect(call).toHaveBeenCalledWith({ type: 'addAccount', label: 'Payouts' });
  });

  it('treats an empty name as "use the default", not as a cancel', async () => {
    dialogPrompt.mockResolvedValue('');
    clicked('+ Add')!.click();
    await settle();

    expect(call).toHaveBeenCalledWith({ type: 'addAccount' });
  });
});

describe('remove account', () => {
  it('asks before removing, and does nothing if declined', async () => {
    dialogConfirm.mockResolvedValue(false);
    clicked('Remove')!.click();
    await settle();

    expect(dialogConfirm).toHaveBeenCalled();
    expect(call.mock.calls.map(([r]) => r.type)).not.toContain('removeAccount');
  });

  it('removes the selected account once confirmed', async () => {
    dialogConfirm.mockResolvedValue(true);
    clicked('Remove')!.click();
    await settle();

    expect(call).toHaveBeenCalledWith({ type: 'removeAccount', index: 1 });
  });

  it('warns that funds are not destroyed', async () => {
    dialogConfirm.mockResolvedValue(false);
    clicked('Remove')!.click();
    await settle();

    const [opts] = dialogConfirm.mock.calls[0]!;
    expect(opts.message).toMatch(/recovery phrase/i);
    expect(opts.message).toMatch(/does not delete/i);
  });
});

describe('wallet tab asset list', () => {
  const assetRows = () =>
    [...document.querySelectorAll('.account')].map((row) => ({
      asset: row.querySelector('.chain')!.textContent,
      amount: row.querySelector('.bal, .tokens')?.textContent ?? '',
      address: row.querySelector('.addr')!.textContent,
      buttons: [...row.querySelectorAll('button')].map((b) => b.textContent),
    }));

  it('lists one row per asset, not per address', async () => {
    await settle();
    const rows = assetRows();

    // ETH and its tokens share 0xabc but are separate assets — the old
    // address-grouped view stacked them under one heading.
    expect(rows.map((r) => r.asset)).toEqual(
      expect.arrayContaining(['ETH', 'USDC_ETH', 'USDC_BASE', 'BTC']),
    );
    const eth = rows.find((r) => r.asset === 'ETH')!;
    const usdc = rows.find((r) => r.asset === 'USDC_ETH')!;
    expect(eth.address).toBe('0xabc');
    expect(usdc.address).toBe('0xabc');
    expect(eth.amount).toContain('0.0113');
    expect(usdc.amount).toContain('20');
  });

  it('puts funded assets first', async () => {
    await settle();
    // Funded rows carry .bal, empty ones .tokens — "0.0113" starts with a zero,
    // so the text is no guide.
    const funded = [...document.querySelectorAll('.account')].map(
      (row) => row.querySelector('.bal') !== null,
    );

    expect(funded).toEqual([...funded].sort((a, b) => Number(b) - Number(a)));
    expect(funded.filter(Boolean)).toHaveLength(4); // ETH, USDC_ETH, USDC_BASE, DOGE
  });

  it('prices balances in the display currency', async () => {
    await settle();
    await settle();
    const eth = assetRows().find((r) => r.asset === 'ETH')!;

    expect(eth.amount).toMatch(/\$0\.02|\$0\.0226/);
  });

  it('offers Send only for assets the wallet can spend', async () => {
    await settle();
    const rows = assetRows();

    expect(rows.find((r) => r.asset === 'ETH')!.buttons).toContain('Send');
    // Base is not a pay-chain: showing Send would promise something the
    // wallet cannot do.
    expect(rows.find((r) => r.asset === 'USDC_BASE')!.buttons).not.toContain('Send');
  });
});

describe('wallet total and unverified assets', () => {
  const rowFor = (asset: string) =>
    [...document.querySelectorAll('.account')].find(
      (row) => row.querySelector('.chain')!.textContent === asset,
    )!;

  it('totals every priced balance', async () => {
    await settle();
    await settle();

    // rate 2 for everything: 0.0113 + 20 + 20 + 5 = 45.0113 -> $90.02
    const total = document.querySelector('.total-value')!.textContent!;
    expect(total).toMatch(/\$90\.02/);
  });

  it('shows chains the extension cannot derive, marked as such', async () => {
    await settle();
    const doge = rowFor('DOGE');

    expect(doge.textContent).toContain('5 DOGE');
    // Honest about provenance: shown for visibility, not verified locally.
    expect(doge.textContent).toMatch(/not derived in this extension/i);
    // And never offered for sending, since it cannot be signed or prepared.
    expect([...doge.querySelectorAll('button')].map((b) => b.textContent)).not.toContain('Send');
  });

  it('does not mark locally derived addresses', async () => {
    await settle();
    expect(rowFor('ETH').textContent).not.toMatch(/not derived/i);
  });
});
