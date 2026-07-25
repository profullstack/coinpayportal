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
