/**
 * Audit every derived payment address for funds that never reached a merchant.
 *
 * Read-only. Walks all of `payment_addresses`, checks the live on-chain balance
 * of each, and reports anything still holding value along with why it is stuck
 * (payment expired, forwarding failed, no payee on the row, and so on).
 *
 * Batched per chain — a naive one-call-per-address sweep over ~2.7k addresses
 * would take the better part of an hour and get rate-limited besides:
 *   SOL          getMultipleAccounts, 100 addresses per call
 *   EVM native   JSON-RPC batch of eth_getBalance
 *   EVM tokens   JSON-RPC batch of eth_call balanceOf
 *   SPL tokens   getTokenAccountsByOwner, one call per address
 *   BTC/others   per-address REST, small concurrency pool
 *
 * Usage:
 *   pnpm tsx scripts/audit-stranded-funds.ts                 # everything
 *   pnpm tsx scripts/audit-stranded-funds.ts --chain SOL,BTC # only these
 *   pnpm tsx scripts/audit-stranded-funds.ts --include-escrow
 *   pnpm tsx scripts/audit-stranded-funds.ts --json out.json
 */

import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const envLocal = join(process.cwd(), '.env.local');
if (existsSync(envLocal)) config({ path: envLocal, override: false });

/**
 * Endpoint lists, tried in order until one answers.
 *
 * The defaults the app ships with are not reliable for a bulk audit — at time
 * of writing polygon-rpc.com answers 401 and eth.llamarpc.com 521. A silent
 * failure here is worse than a slow scan: it reports "no funds found" for
 * addresses that were never actually checked. Every failure is surfaced and
 * counted, and the run exits non-zero if any chain could not be scanned.
 */
const RPC = {
  ETH: [
    process.env.ETHEREUM_RPC_URL,
    'https://ethereum-rpc.publicnode.com',
    'https://eth.drpc.org',
  ].filter(Boolean) as string[],
  POL: [
    process.env.POLYGON_RPC_URL,
    'https://polygon-bor-rpc.publicnode.com',
    'https://polygon.drpc.org',
    'https://1rpc.io/matic',
  ].filter(Boolean) as string[],
  BNB: [process.env.BNB_RPC_URL, 'https://bsc-dataseed.binance.org'].filter(Boolean) as string[],
  BASE: [process.env.BASE_RPC_URL, 'https://mainnet.base.org'].filter(Boolean) as string[],
  SOL: [
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL || process.env.SOLANA_RPC_URL,
    'https://api.mainnet-beta.solana.com',
  ].filter(Boolean) as string[],
  BTC: process.env.BITCOIN_RPC_URL || 'https://blockstream.info/api',
  /** BitPay's Bitcore — the one public BCH/DOGE index still answering freely. */
  BITCORE: 'https://api.bitcore.io/api',
  XRP: process.env.XRP_RPC_URL || 'https://s1.ripple.com:51234',
};

/** Chains that could not be scanned; makes the exit code meaningful. */
const unscanned: { chain: string; count: number; reason: string }[] = [];

const ERC20_BALANCE_OF = '0x70a08231';

/** chain -> { rpc, contract, decimals } for ERC20-style balances. */
const EVM_TOKENS: Record<string, { rpc: string[]; contract: string; decimals: number }> = {
  USDT_ETH: { rpc: RPC.ETH, contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
  USDT: { rpc: RPC.ETH, contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
  USDC_ETH: { rpc: RPC.ETH, contract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
  USDC: { rpc: RPC.ETH, contract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
  USDT_POL: { rpc: RPC.POL, contract: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6 },
  USDC_POL: { rpc: RPC.POL, contract: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
  USDC_BASE: { rpc: RPC.BASE, contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
};

const EVM_NATIVE: Record<string, string[]> = { ETH: RPC.ETH, POL: RPC.POL, BNB: RPC.BNB };

/** Bitcore chain codes for the UTXO chains without a Blockstream index. */
const BITCORE_CHAINS: Record<string, string> = { BCH: 'BCH', DOGE: 'DOGE' };

const SPL_TOKENS: Record<string, { mint: string; decimals: number }> = {
  USDT_SOL: { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
  USDC_SOL: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
};

interface AddrRow {
  address: string;
  cryptocurrency: string;
  payment_id: string | null;
  business_id: string | null;
  amount_expected: string | null;
  merchant_wallet: string | null;
  is_escrow: boolean | null;
  created_at: string;
  pay_status: string;
}

interface Hit extends AddrRow {
  balance: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run tasks with a bounded concurrency pool. */
async function pool<T, R>(items: T[], size: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        try {
          out[i] = await fn(items[i], i);
        } catch {
          out[i] = 0 as unknown as R;
        }
      }
    }),
  );
  return out;
}

async function rpcBatchAt(url: string, calls: object[]): Promise<any[]> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(calls),
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const json = await res.json();
  const rows = Array.isArray(json) ? json : [json];
  // A 200 carrying a JSON-RPC error is still a failure — treat it as one so we
  // fail over rather than recording every address as empty.
  const errored = rows.find((r: any) => r?.error);
  if (errored) throw new Error(`${url} -> ${errored.error.message || 'rpc error'}`);
  return rows;
}

/** Try each endpoint in turn; throw only if every one fails. */
async function rpcBatch(urls: string[], calls: object[]): Promise<any[]> {
  let lastErr: unknown;
  for (const url of urls) {
    try {
      return await rpcBatchAt(url, calls);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Native EVM balances, batched. Throws if a chunk cannot be scanned at all. */
async function evmNativeBalances(urls: string[], addresses: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const CHUNK = 50;
  for (let i = 0; i < addresses.length; i += CHUNK) {
    const chunk = addresses.slice(i, i + CHUNK);
    const calls = chunk.map((a, n) => ({
      jsonrpc: '2.0', id: n, method: 'eth_getBalance', params: [a, 'latest'],
    }));
    const rows = await rpcBatch(urls, calls);
    for (const row of rows) {
      const addr = chunk[row.id];
      if (addr && row.result) result.set(addr, Number(BigInt(row.result)) / 1e18);
    }
    await sleep(120);
  }
  return result;
}

/** ERC20 balances, batched. Throws if a chunk cannot be scanned at all. */
async function evmTokenBalances(
  urls: string[], contract: string, decimals: number, addresses: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const CHUNK = 50;
  for (let i = 0; i < addresses.length; i += CHUNK) {
    const chunk = addresses.slice(i, i + CHUNK);
    const calls = chunk.map((a, n) => ({
      jsonrpc: '2.0', id: n, method: 'eth_call',
      params: [{ to: contract, data: ERC20_BALANCE_OF + a.replace(/^0x/, '').toLowerCase().padStart(64, '0') }, 'latest'],
    }));
    const rows = await rpcBatch(urls, calls);
    for (const row of rows) {
      const addr = chunk[row.id];
      if (addr && row.result && row.result !== '0x') {
        result.set(addr, Number(BigInt(row.result)) / 10 ** decimals);
      }
    }
    await sleep(120);
  }
  return result;
}

/** BCH / DOGE via Bitcore. Address prefixes (`bitcoincash:`) are stripped. */
async function bitcoreBalances(chain: string, addresses: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  let failures = 0;
  await pool(addresses, 4, async (addr) => {
    const bare = addr.includes(':') ? addr.split(':')[1] : addr;
    try {
      const res = await fetch(`${RPC.BITCORE}/${chain}/mainnet/address/${bare}/balance`);
      if (!res.ok) { failures++; return 0; }
      const j: any = await res.json();
      if (j.balance > 0) result.set(addr, j.balance / 1e8);
    } catch { failures++; }
    await sleep(80);
    return 0;
  });
  if (failures === addresses.length && addresses.length > 0) {
    throw new Error(`all ${addresses.length} Bitcore lookups failed`);
  }
  return result;
}

/** XRP via rippled JSON-RPC. Unfunded accounts return actNotFound. */
async function xrpBalances(addresses: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  for (const addr of addresses) {
    const res = await fetch(RPC.XRP, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'account_info',
        params: [{ account: addr, ledger_index: 'validated' }],
      }),
    });
    if (!res.ok) throw new Error(`XRP -> HTTP ${res.status}`);
    const j: any = await res.json();
    const drops = j?.result?.account_data?.Balance;
    if (drops) result.set(addr, Number(drops) / 1e6);
    await sleep(120);
  }
  return result;
}

/** Solana lamport balances via getMultipleAccounts. */
async function solBalances(addresses: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const CHUNK = 100;
  for (let i = 0; i < addresses.length; i += CHUNK) {
    const chunk = addresses.slice(i, i + CHUNK);
    try {
      const [row] = await rpcBatch(RPC.SOL, [{
        jsonrpc: '2.0', id: 1, method: 'getMultipleAccounts',
        params: [chunk, { encoding: 'base64' }],
      }]);
      const values = row?.result?.value || [];
      values.forEach((v: any, n: number) => {
        if (v?.lamports) result.set(chunk[n], v.lamports / 1e9);
      });
    } catch (err) {
      console.error(`  ! sol batch failed (${chunk.length} addrs): ${err instanceof Error ? err.message : err}`);
    }
    await sleep(150);
  }
  return result;
}

/** SPL token balances — one call per owner. */
async function splBalances(mint: string, addresses: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  await pool(addresses, 5, async (addr) => {
    try {
      const [row] = await rpcBatch(RPC.SOL, [{
        jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner',
        params: [addr, { mint }, { encoding: 'jsonParsed' }],
      }]);
      const accounts = row?.result?.value || [];
      let total = 0;
      for (const acc of accounts) {
        total += Number(acc?.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0);
      }
      if (total > 0) result.set(addr, total);
    } catch { /* counted as zero */ }
    return 0;
  });
  return result;
}

/** UTXO chains via Blockstream-compatible REST. */
async function btcBalances(addresses: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  let done = 0;
  await pool(addresses, 5, async (addr) => {
    try {
      const res = await fetch(`${RPC.BTC}/address/${addr}`);
      if (res.ok) {
        const j: any = await res.json();
        const bal = (j.chain_stats.funded_txo_sum - j.chain_stats.spent_txo_sum)
          + (j.mempool_stats.funded_txo_sum - j.mempool_stats.spent_txo_sum);
        if (bal > 0) result.set(addr, bal / 1e8);
      }
    } catch { /* counted as zero */ }
    if (++done % 50 === 0) console.log(`  …${done}/${addresses.length}`);
    await sleep(60);
    return 0;
  });
  return result;
}

async function loadAllAddresses(supabase: any): Promise<AddrRow[]> {
  const rows: AddrRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('payment_addresses')
      .select('address, cryptocurrency, payment_id, business_id, amount_expected, merchant_wallet, is_escrow, created_at')
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`payment_addresses page ${from}: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data.map((d: any) => ({ ...d, pay_status: '(unknown)' })));
    if (data.length < PAGE) break;
  }

  // Attach payment status in bulk.
  const ids = [...new Set(rows.map((r) => r.payment_id).filter(Boolean))] as string[];
  const statusById = new Map<string, string>();
  const IDS_PER_QUERY = 300;
  for (let i = 0; i < ids.length; i += IDS_PER_QUERY) {
    const { data } = await supabase
      .from('payments')
      .select('id, status')
      .in('id', ids.slice(i, i + IDS_PER_QUERY));
    for (const p of data || []) statusById.set(p.id, p.status);
  }
  for (const r of rows) {
    r.pay_status = r.payment_id ? (statusById.get(r.payment_id) ?? '(no payment row)') : '(no payment row)';
  }
  return rows;
}

function diagnose(hit: Hit): string {
  if (hit.is_escrow) return 'escrow-held (settle via /api/escrow/:id/settle)';
  const reasons: string[] = [];
  if (!hit.merchant_wallet || hit.merchant_wallet.trim() === '') reasons.push('no payee on row');
  if (hit.pay_status === 'expired') reasons.push('payment expired');
  if (hit.pay_status === 'confirmed') reasons.push('confirmed but never forwarded');
  if (hit.pay_status === 'forwarding_failed') reasons.push('forwarding failed');
  if (hit.pay_status === 'forwarding') reasons.push('stuck mid-forward');
  if (hit.pay_status === '(no payment row)') reasons.push('orphaned address');
  if (hit.pay_status === 'forwarded') reasons.push('residue after forwarding');
  return reasons.join(' + ') || hit.pay_status;
}

async function main() {
  const argv = process.argv.slice(2);
  const chainArg = argv.includes('--chain') ? argv[argv.indexOf('--chain') + 1] : null;
  const onlyChains = chainArg ? new Set(chainArg.split(',').map((s) => s.trim().toUpperCase())) : null;
  const includeEscrow = argv.includes('--include-escrow');
  const jsonOut = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log('Loading payment addresses…');
  let rows = await loadAllAddresses(supabase);
  console.log(`Loaded ${rows.length} addresses.`);

  if (!includeEscrow) {
    const before = rows.length;
    rows = rows.filter((r) => !r.is_escrow);
    console.log(`Skipping ${before - rows.length} escrow-held addresses (pass --include-escrow to audit them).`);
  }
  if (onlyChains) rows = rows.filter((r) => onlyChains.has(r.cryptocurrency));

  const byChain = new Map<string, AddrRow[]>();
  for (const r of rows) {
    if (!byChain.has(r.cryptocurrency)) byChain.set(r.cryptocurrency, []);
    byChain.get(r.cryptocurrency)!.push(r);
  }

  const hits: Hit[] = [];
  for (const [chain, chainRows] of [...byChain.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const addresses = chainRows.map((r) => r.address);
    process.stdout.write(`Scanning ${chain} (${addresses.length})… `);
    let balances = new Map<string, number>();

    // Addresses the derivation never produced properly can't hold anything and
    // can't be looked up — surface them rather than counting them as clean.
    const malformed = chainRows.filter((r) => r.address.includes('...') || r.address.includes('_'));
    if (malformed.length === chainRows.length && malformed.length > 0) {
      console.log(`SKIPPED — all ${malformed.length} addresses are malformed (derivation bug, cannot receive funds)`);
      unscanned.push({ chain, count: chainRows.length, reason: 'malformed addresses — derivation bug' });
      continue;
    }

    try {
      if (chain === 'SOL') balances = await solBalances(addresses);
      else if (SPL_TOKENS[chain]) balances = await splBalances(SPL_TOKENS[chain].mint, addresses);
      else if (EVM_TOKENS[chain]) {
        const t = EVM_TOKENS[chain];
        balances = await evmTokenBalances(t.rpc, t.contract, t.decimals, addresses);
      } else if (EVM_NATIVE[chain]) balances = await evmNativeBalances(EVM_NATIVE[chain], addresses);
      else if (chain === 'BTC') {
        console.log('');
        balances = await btcBalances(addresses);
      } else if (BITCORE_CHAINS[chain]) {
        balances = await bitcoreBalances(BITCORE_CHAINS[chain], addresses);
      } else if (chain === 'XRP') {
        balances = await xrpBalances(addresses);
      } else {
        console.log('SKIPPED — no balance source wired up for this chain');
        unscanned.push({ chain, count: chainRows.length, reason: 'no balance source' });
        continue;
      }
    } catch (err) {
      console.log(`FAILED: ${err instanceof Error ? err.message : err}`);
      unscanned.push({ chain, count: chainRows.length, reason: err instanceof Error ? err.message : String(err) });
      continue;
    }

    const found = chainRows
      .filter((r) => (balances.get(r.address) || 0) > 0)
      .map((r) => ({ ...r, balance: balances.get(r.address)! }));
    hits.push(...found);
    console.log(`${found.length} with balance`);
  }

  // ── Coverage first: a clean report over a partial scan is a lie ───────
  const scannedCount = rows.length - unscanned.reduce((s, u) => s + u.count, 0);
  console.log(`\n══════════ COVERAGE ══════════`);
  console.log(`Scanned ${scannedCount}/${rows.length} addresses.`);
  if (unscanned.length) {
    console.log('NOT SCANNED — these addresses were never checked:');
    for (const u of unscanned) console.log(`  ${u.chain.padEnd(10)} ${String(u.count).padStart(5)} addr — ${u.reason}`);
  } else {
    console.log('Full coverage — every address was checked.');
  }

  // ── Report ────────────────────────────────────────────────────────────
  console.log('\n══════════ ADDRESSES HOLDING FUNDS ══════════');
  if (!hits.length) {
    console.log('None among the scanned addresses.');
    if (unscanned.length) process.exitCode = 2;
    return;
  }

  const byCoin = new Map<string, Hit[]>();
  for (const h of hits) {
    if (!byCoin.has(h.cryptocurrency)) byCoin.set(h.cryptocurrency, []);
    byCoin.get(h.cryptocurrency)!.push(h);
  }

  for (const [coin, list] of [...byCoin.entries()].sort()) {
    const total = list.reduce((s, h) => s + h.balance, 0);
    console.log(`\n── ${coin} — ${list.length} address(es), ${total.toFixed(8)} total`);
    for (const h of list.sort((a, b) => b.balance - a.balance)) {
      console.log(`  ${h.balance.toFixed(8).padStart(16)}  ${h.address}`);
      console.log(`  ${''.padStart(16)}  ${diagnose(h)}  · payment=${h.payment_id ?? '—'} · ${h.created_at.slice(0, 10)}`);
    }
  }

  console.log('\n── Totals by coin ──');
  for (const [coin, list] of [...byCoin.entries()].sort()) {
    console.log(`  ${coin.padEnd(10)} ${list.reduce((s, h) => s + h.balance, 0).toFixed(8)}  (${list.length} addr)`);
  }

  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify({ hits, unscanned }, null, 2));
    console.log(`\nWrote ${hits.length} records to ${jsonOut}`);
  }
  if (unscanned.length) {
    console.log('\n⚠️  Coverage was incomplete — see the COVERAGE section above. Exit code 2.');
    process.exitCode = 2;
  }
  console.log('\n(read-only — nothing was modified)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
