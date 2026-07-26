import { describe, it, expect, beforeEach } from 'vitest';
import { WalletService } from '../wallet.js';
import { MemoryStorage } from '../storage.js';
import { seedFromMnemonic } from '../derivation.js';

// Standard BIP-39 test vector.
const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function newService() {
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  return { svc: new WalletService(local, session), local, session };
}

describe('WalletService lifecycle', () => {
  let ctx: ReturnType<typeof newService>;
  beforeEach(() => {
    ctx = newService();
  });

  it('creates a wallet, returns a 12-word mnemonic once, derives all chains', async () => {
    const { mnemonic, accounts } = await ctx.svc.create('pw');
    expect(mnemonic.split(' ')).toHaveLength(12);
    expect(accounts.map((a) => a.chain).sort()).toEqual(['BCH', 'BTC', 'ETH', 'POL', 'SOL']);
    expect(await ctx.svc.isInitialized()).toBe(true);
    expect(await ctx.svc.isUnlocked()).toBe(true);
  });

  it('never persists the mnemonic or plaintext seed in local storage', async () => {
    const { mnemonic } = await ctx.svc.create('pw');
    const localBlob = JSON.stringify(ctx.local.snapshot());
    expect(localBlob).not.toContain(mnemonic);
    expect(localBlob).not.toContain(mnemonic.split(' ')[0] + ' ' + mnemonic.split(' ')[1]);
    // The plaintext seed lives only in session, not local.
    expect(Object.keys(ctx.local.snapshot())).not.toContain('seed');
    expect(Object.keys(ctx.session.snapshot())).toContain('seed');
  });

  it('locks and unlocks; wrong password is rejected', async () => {
    await ctx.svc.import(TEST_MNEMONIC, 'hunter2');
    const before = await ctx.svc.getAccounts();

    await ctx.svc.lock();
    expect(await ctx.svc.isUnlocked()).toBe(false);
    await expect(ctx.svc.requireSeed()).rejects.toThrow(/locked/i);

    await expect(ctx.svc.unlock('wrong')).rejects.toThrow(/incorrect password/i);

    const after = await ctx.svc.unlock('hunter2');
    expect(after).toEqual(before);
    expect(await ctx.svc.isUnlocked()).toBe(true);

    // Seed recovered after unlock matches the mnemonic's seed.
    const seed = await ctx.svc.requireSeed();
    expect([...seed]).toEqual([...seedFromMnemonic(TEST_MNEMONIC)]);
  });

  it('rejects an invalid mnemonic on import', async () => {
    await expect(ctx.svc.import('not a real seed phrase at all', 'pw')).rejects.toThrow(/invalid/i);
  });

  it('refuses to create over an existing wallet', async () => {
    await ctx.svc.create('pw');
    await expect(ctx.svc.create('pw')).rejects.toThrow(/already exists/i);
  });

  it('beginCreate does not persist until confirmCreate (backup gate)', async () => {
    const { mnemonic, accounts } = await ctx.svc.beginCreate();
    expect(mnemonic.split(' ')).toHaveLength(12);
    expect(accounts).toHaveLength(5);
    // Not usable yet: no vault persisted.
    expect(await ctx.svc.isInitialized()).toBe(false);
    expect(Object.keys(ctx.local.snapshot())).not.toContain('vault');

    await ctx.svc.confirmCreate('pw');
    expect(await ctx.svc.isInitialized()).toBe(true);
    expect(await ctx.svc.isUnlocked()).toBe(true);
    // Preview addresses match the persisted ones.
    expect(await ctx.svc.getAccounts()).toEqual(accounts);
  });

  it('cancelCreate discards a pending creation', async () => {
    await ctx.svc.beginCreate();
    await ctx.svc.cancelCreate();
    await expect(ctx.svc.confirmCreate('pw')).rejects.toThrow(/no pending/i);
    expect(await ctx.svc.isInitialized()).toBe(false);
  });

  it('import is deterministic for a given mnemonic', async () => {
    await ctx.svc.import(TEST_MNEMONIC, 'pw');
    const a = await ctx.svc.getAccounts();
    const b = newService();
    await b.svc.import(TEST_MNEMONIC, 'different-password');
    expect(await b.svc.getAccounts()).toEqual(a); // addresses independent of password
  });
});

describe('multiple accounts (one seed, many BIP-44 indexes)', () => {
  let ctx: ReturnType<typeof newService>;
  beforeEach(async () => {
    ctx = newService();
    await ctx.svc.import(TEST_MNEMONIC, 'password123');
  });

  it('starts with a single account at index 0', async () => {
    expect(await ctx.svc.listAccounts()).toEqual([{ index: 0, label: 'Account 1' }]);
    expect(await ctx.svc.getActiveAccount()).toBe(0);
  });

  it('derives a new account with different addresses from the same phrase', async () => {
    const first = await ctx.svc.getAccounts();
    const added = await ctx.svc.addAccount();

    expect(added).toEqual({ index: 1, label: 'Account 2' });
    const second = await ctx.svc.getAccounts();
    expect(second).toHaveLength(first.length);
    // Same chains, different addresses — a genuinely separate account.
    expect(second.map((a) => a.chain)).toEqual(first.map((a) => a.chain));
    for (const chain of first.map((a) => a.chain)) {
      const a = first.find((x) => x.chain === chain)!.address;
      const b = second.find((x) => x.chain === chain)!.address;
      expect(b).not.toBe(a);
    }
  });

  it('makes the new account active, and switching back restores the old addresses', async () => {
    const first = await ctx.svc.getAccounts();
    await ctx.svc.addAccount();
    expect(await ctx.svc.getActiveAccount()).toBe(1);

    const restored = await ctx.svc.selectAccount(0);
    expect(await ctx.svc.getActiveAccount()).toBe(0);
    expect(restored).toEqual(first);
  });

  it('accepts a custom label and can rename afterwards', async () => {
    await ctx.svc.addAccount('  Payouts  ');
    expect((await ctx.svc.listAccounts())[1].label).toBe('Payouts');

    const renamed = await ctx.svc.renameAccount(1, 'Treasury');
    expect(renamed[1].label).toBe('Treasury');
    await expect(ctx.svc.renameAccount(1, '   ')).rejects.toThrow(/cannot be empty/);
  });

  it('refuses to select an account that does not exist', async () => {
    await expect(ctx.svc.selectAccount(7)).rejects.toThrow(/No such account/);
  });

  it('cannot add an account while locked — addresses need the seed', async () => {
    await ctx.svc.lock();
    await expect(ctx.svc.addAccount()).rejects.toThrow(/locked/i);
  });

  it('is deterministic: the same index always yields the same addresses', async () => {
    await ctx.svc.addAccount();
    const before = await ctx.svc.getAccounts();

    const fresh = newService();
    await fresh.svc.import(TEST_MNEMONIC, 'password123');
    await fresh.svc.addAccount();
    expect(await fresh.svc.getAccounts()).toEqual(before);
  });

  describe('removeAccount', () => {
    it('hides the account from the list', async () => {
      await ctx.svc.addAccount('Payouts');
      const { accounts } = await ctx.svc.removeAccount(1);

      expect(accounts.map((a) => a.index)).toEqual([0]);
      expect(await ctx.svc.listAccounts()).toHaveLength(1);
    });

    it('never reissues a removed index', async () => {
      // Otherwise a "new" account would silently inherit the old one's
      // addresses — including anything sent there after removal.
      await ctx.svc.addAccount('Payouts'); // index 1
      await ctx.svc.removeAccount(1);
      const next = await ctx.svc.addAccount('Fresh');

      expect(next.index).toBe(2);
    });

    it('moves off the removed account when it was active', async () => {
      await ctx.svc.addAccount('Payouts'); // becomes active
      expect(await ctx.svc.getActiveAccount()).toBe(1);

      const { activeAccount } = await ctx.svc.removeAccount(1);
      expect(activeAccount).toBe(0);
      expect(await ctx.svc.getActiveAccount()).toBe(0);
      expect(await ctx.svc.getAccounts()).toEqual(await ctx.svc.addressesFor(0));
    });

    it('leaves the active account alone when another one is removed', async () => {
      await ctx.svc.addAccount('Payouts'); // index 1, active
      await ctx.svc.addAccount('Third'); // index 2, active
      await ctx.svc.removeAccount(1);

      expect(await ctx.svc.getActiveAccount()).toBe(2);
    });

    it('refuses to remove the only account', async () => {
      await expect(ctx.svc.removeAccount(0)).rejects.toThrow(/only account/i);
      expect(await ctx.svc.listAccounts()).toHaveLength(1);
    });

    it('refuses an unknown or already-removed account', async () => {
      await ctx.svc.addAccount('Payouts');
      await ctx.svc.removeAccount(1);

      await expect(ctx.svc.removeAccount(1)).rejects.toThrow(/No such account/);
      await expect(ctx.svc.removeAccount(7)).rejects.toThrow(/No such account/);
    });

    it('cannot select or rename a removed account', async () => {
      await ctx.svc.addAccount('Payouts');
      await ctx.svc.removeAccount(1);

      await expect(ctx.svc.selectAccount(1)).rejects.toThrow(/No such account/);
      await expect(ctx.svc.renameAccount(1, 'Back')).rejects.toThrow(/No such account/);
    });

    it('drops the removed account cached addresses', async () => {
      await ctx.svc.addAccount('Payouts');
      await ctx.svc.removeAccount(1);

      const book = ctx.local.snapshot().accounts as Record<string, unknown>;
      expect(book[1]).toBeUndefined();
      expect(book[0]).toBeDefined();
    });
  });

  it('keeps addresses from wallets created before multi-account existed', async () => {
    // Pre-migration installs stored a bare array under `accounts`.
    const legacy = newService();
    const addresses = [{ chain: 'ETH', address: '0xlegacy', tokens: [] }];
    await legacy.local.set('accounts', addresses);
    await legacy.local.set('vault', { v: 1 });

    expect(await legacy.svc.getAccounts()).toEqual(addresses);
    expect(await legacy.svc.listAccounts()).toEqual([{ index: 0, label: 'Account 1' }]);
  });
});
