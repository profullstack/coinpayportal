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

describe('addresses per chain (the web wallet model)', () => {
  let ctx: ReturnType<typeof newService>;
  beforeEach(async () => {
    ctx = newService();
    await ctx.svc.import(TEST_MNEMONIC, 'password123');
  });

  it('starts with one address per chain, at index 0', async () => {
    const book = await ctx.svc.addresses();
    for (const entries of Object.values(book)) {
      expect(entries).toHaveLength(1);
      expect(entries[0]!.index).toBe(0);
    }
  });

  it('advances one chain without touching the others', async () => {
    // The web wallet issues a fresh address per chain on request, and each
    // chain advances on its own — BTC can be on 2 while POL is still on 0.
    const added = await ctx.svc.addAddress('SOL');
    expect(added.index).toBe(1);

    const book = await ctx.svc.addresses();
    expect(book.SOL).toHaveLength(2);
    expect(book.BTC).toHaveLength(1);
  });

  it('derives a genuinely different address, deterministically', async () => {
    const first = (await ctx.svc.primaryAddress('SOL'))!;
    const second = await ctx.svc.addAddress('SOL');
    expect(second.address).not.toBe(first.address);

    // Same phrase, same index, same address — always.
    const other = newService();
    await other.svc.import(TEST_MNEMONIC, 'password123');
    await other.svc.addAddress('SOL');
    expect((await other.svc.addresses()).SOL![1]!.address).toBe(second.address);
  });

  it('never reuses an index', async () => {
    await ctx.svc.addAddress('ETH');
    const third = await ctx.svc.addAddress('ETH');
    expect(third.index).toBe(2);
  });

  it('reports the index behind an address, for signing', async () => {
    const second = await ctx.svc.addAddress('ETH');
    expect(await ctx.svc.indexOf('ETH', second.address)).toBe(1);
    // EIP-55 casing must not change the answer.
    expect(await ctx.svc.indexOf('ETH', second.address.toUpperCase())).toBe(1);
    expect(await ctx.svc.indexOf('ETH', '0xnot-mine')).toBeUndefined();
  });

  it('cannot derive another address while locked', async () => {
    await ctx.svc.lock();
    await expect(ctx.svc.addAddress('BTC')).rejects.toThrow(/locked/i);
  });

  it('migrates an account-shaped book into per-chain lists', async () => {
    // "Account 2" held index 1 of every chain; each becomes that chain's
    // index-1 address, so nothing that holds funds is lost.
    const legacy = newService();
    await legacy.local.set('vault', { v: 1 });
    await legacy.local.set('accounts', {
      0: [{ chain: 'ETH', address: '0xzero', tokens: [] }],
      1: [{ chain: 'ETH', address: '0xone', tokens: [] }],
    });
    await legacy.local.set('accountList', [{ index: 0, label: 'Account 1' }]);

    const book = await legacy.svc.addresses();
    expect(book.ETH).toEqual([
      { index: 0, address: '0xzero', tokens: [] },
      { index: 1, address: '0xone', tokens: [] },
    ]);
    // The old keys are cleared so nothing reads them again.
    expect(legacy.local.snapshot().accounts).toBeUndefined();
    expect(legacy.local.snapshot().accountList).toBeUndefined();
  });

  it('migrates the oldest layout, a bare array', async () => {
    const legacy = newService();
    await legacy.local.set('vault', { v: 1 });
    await legacy.local.set('accounts', [{ chain: 'ETH', address: '0xlegacy', tokens: [] }]);

    const book = await legacy.svc.addresses();
    expect(book.ETH).toEqual([{ index: 0, address: '0xlegacy', tokens: [] }]);
  });
});
