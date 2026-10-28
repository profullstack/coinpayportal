import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 2026-10-28: /api/payouts/create could not send for anyone. Business wallets
 * are receive addresses with no key (0 of 1,475 had one), and a USDC_POL
 * payout would have gone through the native Polygon provider, i.e. sent POL.
 * Payouts now send from a CoinPay-held payout wallet, and ERC-20 coins move
 * as token transfers.
 */

const tokenSend = vi.hoisted(() => ({
  checkTokenPayout: vi.fn(),
  sendTokenPayout: vi.fn(),
}));
const nativeProvider = vi.hoisted(() => ({
  getBalance: vi.fn(),
  sendTransaction: vi.fn(),
}));

vi.mock('./evm-token-send', async (orig) => ({ ...(await orig<object>()), ...tokenSend }));
// The vault service reads secret_vaults/businesses through the admin client.
const dbHolder = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => dbHolder.db }));
vi.mock('@/lib/blockchain/providers', () => ({
  getProvider: () => nativeProvider,
  getRpcUrl: () => 'http://rpc.test',
}));
vi.mock('@/lib/rates/tatum', () => ({ getCryptoPrice: vi.fn(async (usd: number) => usd) }));
vi.mock('@/lib/crypto/encryption', () => ({
  encrypt: (s: string) => `enc:${s}`,
  decrypt: (s: string) => s.replace(/^enc:/, ''),
}));
vi.mock('../crypto/require-key', () => ({ requireEncryptionKey: () => 'k' }));
vi.mock('@/lib/crypto/require-key', () => ({ requireEncryptionKey: () => 'k' }));

const { createPayout } = await import('./service');
const { ensurePayoutWallet, payoutFamilyFor } = await import('./payout-wallet');
const { toTokenUnits } = await import('./evm-token-send');
const sealedVault = await import('@/lib/vault/sealed-vault');
const vaultService = await import('@/lib/vault/vault-service');
const { resetUnlockStore } = await import('@/lib/vault/unlock-store');

// Tiny supabase stand-in: tables of rows, eq filters, insert/update.
function fakeDb(tables: Record<string, any[]>) {
  const from = (name: string) => {
    tables[name] ??= [];
    const filters: Array<(r: any) => boolean> = [];
    let op: 'select' | 'insert' | 'update' = 'select';
    let payload: any = null;
    const run = () => {
      const rows = tables[name];
      if (op === 'insert') {
        const row = { id: `id-${rows.length + 1}`, created_at: 'now', ...payload };
        rows.push(row);
        return [row];
      }
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === 'update') hit.forEach((r) => Object.assign(r, payload));
      return hit;
    };
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
      insert: (p: any) => { op = 'insert'; payload = p; return q; },
      update: (p: any) => { op = 'update'; payload = p; return q; },
      single: async () => { const d = run()[0]; return { data: d ?? null, error: d ? null : { message: 'none' } }; },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then: (res: any, rej: any) => Promise.resolve({ data: run(), error: null }).then(res, rej),
    };
    return q;
  };
  return { from, tables } as any;
}

const RECIPIENT = '0xcCF572F86636F4C04E58F070be23a15c2DFc6643';
const input = { recipient_email: 'op@example.com', recipient_wallet: RECIPIENT, amount_usd: 0.05564, cryptocurrency: 'USDC_POL' };

let db: any;
let merchant = '';
let n = 0;

/** Give the business owner a secrets vault, optionally unlocked. */
async function setupVault({ unlock = true } = {}) {
  const { record, dek } = await sealedVault.createVault('correct horse battery', 'merchant', merchant);
  await vaultService.createVault('merchant', merchant, record);
  if (unlock) await vaultService.unlockVault('merchant', merchant, sealedVault.bytesToBase64(dek), 3600_000);
}

beforeEach(async () => {
  vi.clearAllMocks();
  resetUnlockStore();
  merchant = `m-${++n}`;
  db = fakeDb({
    secret_vaults: [],
    businesses: [{ id: 'b1', merchant_id: merchant }],
    // the receive address: no key, must never be used to sign
    business_wallets: [{ business_id: 'b1', cryptocurrency: 'USDC_POL', wallet_address: '0xRECEIVE', is_active: true, encrypted_private_key: null }],
  });
  dbHolder.db = db;
  await setupVault();
});

describe('payout wallet', () => {
  it('is created once and never rotated', async () => {
    const a = await ensurePayoutWallet(db, 'b1');
    const b = await ensurePayoutWallet(db, 'b1');
    expect(a.created).toBe(true);
    expect(b).toEqual({ address: a.address, created: false });
    expect(db.tables.business_payout_wallets).toHaveLength(1);
    // Sealed to the owner's vault; ENCRYPTION_KEY opens nothing.
    expect(db.tables.business_payout_wallets[0].encrypted_private_key).toMatch(/^cpv1\./);
    expect(db.tables.business_payout_wallets[0].encrypted_private_key).not.toMatch(/0x[0-9a-f]{64}/);
  });

  it('is refused before any key exists when the owner has no vault', async () => {
    db.tables.businesses[0].merchant_id = 'no-vault-merchant';
    await expect(ensurePayoutWallet(db, 'b1')).rejects.toBeInstanceOf(vaultService.VaultMissingError);
    expect(db.tables.business_payout_wallets ?? []).toHaveLength(0);
  });

  it('covers EVM coins only', () => {
    expect(payoutFamilyFor('usdc_pol')).toBe('evm');
    expect(payoutFamilyFor('POL')).toBe('evm');
    expect(payoutFamilyFor('USDC_SOL')).toBeNull();
    expect(payoutFamilyFor('BTC')).toBeNull();
  });

  it('rounds token amounts down to what exists on chain', () => {
    expect(toTokenUnits(0.05564, 6)).toBe(55640n);
    expect(toTokenUnits(6.44064406, 6)).toBe(6440644n);
  });
});

describe('createPayout', () => {
  it('without a payout wallet refuses before creating any payout record', async () => {
    const out = await createPayout(db, 'b1', input);
    expect(out.success).toBe(false);
    expect(out.payout).toBeUndefined();
    expect(out.error).toMatch(/No payout wallet for USDC_POL/);
  });

  it('sends a USDC_POL payout as a token transfer from the payout wallet, never native POL', async () => {
    const { address } = await ensurePayoutWallet(db, 'b1');
    tokenSend.checkTokenPayout.mockResolvedValue({ ok: true, units: 55640n, tokenBalance: '1', nativeBalance: '1' });
    tokenSend.sendTokenPayout.mockResolvedValue('0xtx');
    const out = await createPayout(db, 'b1', input);
    expect(out.success).toBe(true);
    expect(out.payout?.tx_hash).toBe('0xtx');
    expect(tokenSend.sendTokenPayout).toHaveBeenCalledWith('http://rpc.test', 'USDC_POL', address, RECIPIENT, 55640n, expect.stringMatching(/^0x/));
    expect(nativeProvider.sendTransaction).not.toHaveBeenCalled();
    expect(nativeProvider.getBalance).not.toHaveBeenCalled();
  });

  it('an unfunded payout wallet is refused before any record (nothing sent)', async () => {
    await ensurePayoutWallet(db, 'b1');
    tokenSend.checkTokenPayout.mockResolvedValue({ ok: false, error: 'Insufficient gas. Payout wallet 0x.. has 0 POL', units: 1n });
    const out = await createPayout(db, 'b1', input);
    expect(out).toMatchObject({ success: false, error: expect.stringMatching(/Insufficient gas/) });
    expect(out.payout).toBeUndefined();
    expect(tokenSend.sendTokenPayout).not.toHaveBeenCalled();
  });

  it('native coins still use the chain provider', async () => {
    await ensurePayoutWallet(db, 'b1');
    nativeProvider.getBalance.mockResolvedValue('10');
    nativeProvider.sendTransaction.mockResolvedValue('0xnative');
    const out = await createPayout(db, 'b1', { ...input, cryptocurrency: 'POL' });
    expect(out.success).toBe(true);
    expect(nativeProvider.sendTransaction).toHaveBeenCalled();
    expect(tokenSend.sendTokenPayout).not.toHaveBeenCalled();
  });

  it('while locked answers 423 before any record exists, and sends nothing', async () => {
    await ensurePayoutWallet(db, 'b1');
    vaultService.lockVault('merchant', merchant);
    const out = await createPayout(db, 'b1', input);
    expect(out).toMatchObject({ success: false, code: 'vault_locked', httpStatus: 423 });
    expect(out.error).toMatch(/unlock a payout session/);
    expect(db.tables.affiliate_payouts ?? []).toHaveLength(0);
    expect(tokenSend.checkTokenPayout).not.toHaveBeenCalled();
    expect(tokenSend.sendTokenPayout).not.toHaveBeenCalled();
  });

  it('a legacy ENCRYPTION_KEY key is re-sealed on first use while unlocked', async () => {
    db.tables.business_payout_wallets = [
      { id: 'w1', business_id: 'b1', family: 'evm', address: '0x00000000000000000000000000000000000000aa', encrypted_private_key: 'enc:0x' + '1'.repeat(64) },
    ];
    tokenSend.checkTokenPayout.mockResolvedValue({ ok: true, units: 55640n, tokenBalance: '1', nativeBalance: '1' });
    tokenSend.sendTokenPayout.mockResolvedValue('0xtx');
    const out = await createPayout(db, 'b1', input);
    expect(out.success).toBe(true);
    expect(tokenSend.sendTokenPayout).toHaveBeenCalledWith(expect.anything(), 'USDC_POL', expect.anything(), RECIPIENT, 55640n, '0x' + '1'.repeat(64));
    expect(db.tables.business_payout_wallets[0].encrypted_private_key).toMatch(/^cpv1\./);
    expect(db.tables.business_payout_wallets[0].seal_version).toBe(2);
  });
});
