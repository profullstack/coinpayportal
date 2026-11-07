/**
 * Profullstack Pass: deposit $99 into your own CoinPay web wallet and get one
 * free month on every Profullstack property that signs in with CoinPay.
 *
 * Non-custodial by design. The money never leaves the user's wallet; we count
 * confirmed incoming deposits on the web wallets they linked to their account
 * (wallet_account_links, which requires a signed proof of control), record
 * which transactions were counted so none funds a second pass, and grant the
 * month once per account. Properties learn about it from the `pass` claim on
 * /api/oauth/userinfo.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const PASS_THRESHOLD_USD = 99;
export const PASS_DAYS = 30;

export interface PassStatus {
  active: boolean;
  claimed: boolean;
  starts_at?: string;
  expires_at?: string;
  deposit_usd?: number;
}

export interface DepositTx {
  id: string;
  chain: string;
  tx_hash: string;
  amount: string | number;
  from_address: string;
}

export interface CountedDeposit {
  tx: DepositTx;
  usd: number;
}

/** The coin whose USD price values a deposit on `chain`; null for dollar stablecoins. */
export function priceSymbolForChain(chain: string): string | null {
  const c = chain.toUpperCase();
  if (c.startsWith('USDC') || c.startsWith('USDT')) return null;
  if (c === 'BASE') return 'ETH';
  if (c === 'LN') return 'BTC';
  return c;
}

/**
 * Pick the deposits that count and value them in USD (at today's price).
 *
 * Skipped: transactions already counted for any pass, and transfers sent from
 * another CoinPay web wallet, so one $99 cannot be passed between accounts to
 * mint a month for each.
 */
export async function evaluateDeposits(
  txs: DepositTx[],
  opts: {
    credited: Set<string>;
    internalAddresses: Set<string>;
    usdRate: (symbol: string) => Promise<number>;
  },
): Promise<{ counted: CountedDeposit[]; totalUsd: number }> {
  const counted: CountedDeposit[] = [];
  const seen = new Set<string>();
  const rates = new Map<string, number>();

  for (const tx of txs) {
    const key = `${tx.chain}:${tx.tx_hash}`;
    if (seen.has(key) || opts.credited.has(key)) continue;
    if (opts.internalAddresses.has(tx.from_address.toLowerCase())) continue;
    const amount = Number(tx.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    seen.add(key);

    const symbol = priceSymbolForChain(tx.chain);
    let rate = 1;
    if (symbol) {
      if (!rates.has(symbol)) {
        try {
          rates.set(symbol, await opts.usdRate(symbol));
        } catch {
          rates.set(symbol, NaN);
        }
      }
      rate = rates.get(symbol)!;
    }
    if (!Number.isFinite(rate) || rate <= 0) continue;

    counted.push({ tx, usd: Math.round(amount * rate * 100) / 100 });
  }

  const totalUsd = Math.round(counted.reduce((s, d) => s + d.usd, 0) * 100) / 100;
  return { counted, totalUsd };
}

export function passFromGrant(
  grant: { starts_at: string; expires_at: string; deposit_usd: number | string } | null,
  now = new Date(),
): PassStatus {
  if (!grant) return { active: false, claimed: false };
  return {
    active: new Date(grant.expires_at).getTime() > now.getTime(),
    claimed: true,
    starts_at: grant.starts_at,
    expires_at: grant.expires_at,
    deposit_usd: Number(grant.deposit_usd),
  };
}

export async function getPassStatus(supabase: SupabaseClient, merchantId: string): Promise<PassStatus> {
  const { data } = await supabase
    .from('pass_grants')
    .select('starts_at, expires_at, deposit_usd')
    .eq('merchant_id', merchantId)
    .maybeSingle();
  return passFromGrant(data ?? null);
}

export type ClaimResult =
  | { status: 'granted' | 'already_claimed'; pass: PassStatus }
  | { status: 'no_wallet'; pass: PassStatus }
  | { status: 'insufficient'; pass: PassStatus; deposit_usd: number; needed_usd: number };

export interface ClaimDeps {
  syncWallet: (walletId: string) => Promise<unknown>;
  usdRate: (symbol: string) => Promise<number>;
  now?: () => Date;
}

export async function claimPass(
  supabase: SupabaseClient,
  merchantId: string,
  deps: ClaimDeps,
): Promise<ClaimResult> {
  const existing = await getPassStatus(supabase, merchantId);
  if (existing.claimed) return { status: 'already_claimed', pass: existing };

  const { data: links } = await supabase
    .from('wallet_account_links')
    .select('wallet_id')
    .eq('merchant_id', merchantId);
  const walletIds = [...new Set((links ?? []).map((l: { wallet_id: string }) => l.wallet_id))];
  if (walletIds.length === 0) return { status: 'no_wallet', pass: existing };

  // Pull external deposits from chain first; a failed sync still counts what we already have.
  await Promise.all(walletIds.map((id) => deps.syncWallet(id).catch(() => undefined)));

  const { data: txs } = await supabase
    .from('wallet_transactions')
    .select('id, chain, tx_hash, amount, from_address')
    .in('wallet_id', walletIds)
    .eq('direction', 'incoming')
    .eq('status', 'confirmed');
  const deposits = (txs ?? []) as DepositTx[];

  const hashes = [...new Set(deposits.map((t) => t.tx_hash))];
  const fromAddrs = [...new Set(deposits.map((t) => t.from_address))];

  const credited = new Set<string>();
  if (hashes.length) {
    const { data } = await supabase.from('pass_grant_deposits').select('chain, tx_hash').in('tx_hash', hashes);
    for (const r of data ?? []) credited.add(`${r.chain}:${r.tx_hash}`);
  }

  const internalAddresses = new Set<string>();
  if (fromAddrs.length) {
    const { data } = await supabase.rpc('pass_internal_addresses', { addrs: fromAddrs });
    for (const r of (data ?? []) as unknown[]) {
      const addr = typeof r === 'string' ? r : Object.values(r as Record<string, string>)[0];
      if (addr) internalAddresses.add(String(addr).toLowerCase());
    }
  }

  const { counted, totalUsd } = await evaluateDeposits(deposits, {
    credited,
    internalAddresses,
    usdRate: deps.usdRate,
  });

  if (totalUsd < PASS_THRESHOLD_USD) {
    return {
      status: 'insufficient',
      pass: existing,
      deposit_usd: totalUsd,
      needed_usd: Math.round((PASS_THRESHOLD_USD - totalUsd) * 100) / 100,
    };
  }

  // Claim the transactions first: UNIQUE(chain, tx_hash) makes a concurrent claim
  // of the same deposit by another account fail here, before any month is granted.
  const { data: inserted, error: depErr } = await supabase
    .from('pass_grant_deposits')
    .insert(
      counted.map((d) => ({
        merchant_id: merchantId,
        wallet_transaction_id: d.tx.id,
        chain: d.tx.chain,
        tx_hash: d.tx.tx_hash,
        amount: d.tx.amount,
        usd_value: d.usd,
      })),
    )
    .select('id');
  if (depErr) throw new Error(`Could not record deposits: ${depErr.message}`);

  const now = deps.now?.() ?? new Date();
  const expires = new Date(now.getTime() + PASS_DAYS * 24 * 60 * 60 * 1000);
  const { data: grant, error: grantErr } = await supabase
    .from('pass_grants')
    .insert({
      merchant_id: merchantId,
      starts_at: now.toISOString(),
      expires_at: expires.toISOString(),
      deposit_usd: totalUsd,
    })
    .select('starts_at, expires_at, deposit_usd')
    .single();

  if (grantErr || !grant) {
    // Lost a race with a second claim from the same account: give the deposits back.
    const ids = (inserted ?? []).map((r: { id: string }) => r.id);
    if (ids.length) await supabase.from('pass_grant_deposits').delete().in('id', ids);
    const again = await getPassStatus(supabase, merchantId);
    if (again.claimed) return { status: 'already_claimed', pass: again };
    throw new Error(`Could not grant pass: ${grantErr?.message ?? 'unknown error'}`);
  }

  return { status: 'granted', pass: passFromGrant(grant, now) };
}
