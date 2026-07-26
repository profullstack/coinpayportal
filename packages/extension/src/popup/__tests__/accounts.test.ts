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
        return { ok: true, accounts: [{ chain: 'ETH', address: '0xabc', tokens: [] }] };
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
        return { ok: true, quote: { coin: 'ETH', fiat: 'USD', rate: 3000, fetchedAt: 0 } };
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
