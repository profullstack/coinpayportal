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
