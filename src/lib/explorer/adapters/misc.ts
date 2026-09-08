/**
 * Solana, XRP Ledger and Cardano.
 *
 * Grouped because each is a single API with no family to share:
 *
 *   SOL  JSON-RPC — keyless, but the public endpoint throttles hard
 *   XRP  xrplcluster.com — `account_tx` returns history to ledger 32570
 *   ADA  Koios — keyless, so no Blockfrost key is needed for any of this
 */

import { fetchWithTimeout } from '@/lib/http/fetch-timeout';
import { solanaRpcUrl } from '../chains';
import { NotFoundError, UpstreamError } from '../types';
import type { ExplorerAddress, ExplorerBlock, ExplorerTransaction } from '../types';
import { fromBaseUnits, sumBaseUnits } from '../units';

const MAX_TXS = 25;

/**
 * The XRP Ledger counts seconds from 2000-01-01, not 1970-01-01. Reading a
 * `date` as a Unix timestamp puts every transaction thirty years in the past.
 */
const RIPPLE_EPOCH_OFFSET = 946_684_800;

async function postJson<T>(url: string, body: unknown): Promise<T> {
  let resp: Response;
  try {
    resp = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new UpstreamError(err instanceof Error ? err.message : String(err));
  }
  if (!resp.ok) {
    await resp.text().catch(() => undefined);
    throw new UpstreamError(`HTTP ${resp.status}`);
  }
  return (await resp.json()) as T;
}

// ── Solana ──────────────────────────────────────────────────────────────────

async function solRpc<T>(method: string, params: unknown[]): Promise<T> {
  const body = await postJson<{ result?: T; error?: { message?: string } }>(solanaRpcUrl(), {
    jsonrpc: '2.0',
    id: 1,
    method,
    params,
  });
  if (body.error) throw new UpstreamError(body.error.message || 'RPC error');
  if (body.result === null || body.result === undefined) throw new NotFoundError();
  return body.result;
}

interface SolTx {
  slot?: number;
  blockTime?: number | null;
  meta?: { fee?: number; err?: unknown; preBalances?: number[]; postBalances?: number[] } | null;
  transaction?: { message?: { accountKeys?: unknown[] } };
}

function solAccountKey(tx: SolTx, index: number): string | null {
  const key = tx.transaction?.message?.accountKeys?.[index];
  if (typeof key === 'string') return key;
  if (key && typeof key === 'object' && 'pubkey' in key) {
    return String((key as { pubkey: unknown }).pubkey);
  }
  return null;
}

function solToTx(signature: string, tx: SolTx): ExplorerTransaction {
  // Solana has no "amount" of its own: a transaction is a set of instructions.
  // The lamport delta on the fee payer is the closest honest single figure,
  // and it is what a reader is looking for on a simple transfer.
  const pre = tx.meta?.preBalances?.[0];
  const post = tx.meta?.postBalances?.[0];
  const delta = pre !== undefined && post !== undefined ? BigInt(pre) - BigInt(post) : 0n;
  const fee = BigInt(tx.meta?.fee ?? 0);
  const moved = delta > fee ? delta - fee : 0n;

  return {
    hash: signature,
    chainId: 'sol',
    status: tx.meta?.err ? 'failed' : tx.slot ? 'confirmed' : 'pending',
    blockHeight: tx.slot ?? null,
    timestamp: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null,
    confirmations: null,
    fee: fromBaseUnits(fee, 9),
    amount: fromBaseUnits(moved, 9),
    transfers: [
      {
        from: solAccountKey(tx, 0),
        to: solAccountKey(tx, 1),
        amount: fromBaseUnits(moved, 9),
      },
    ],
  };
}

async function getSolTransaction(signature: string): Promise<ExplorerTransaction> {
  const tx = await solRpc<SolTx>('getTransaction', [
    signature,
    { maxSupportedTransactionVersion: 0, encoding: 'jsonParsed' },
  ]);
  return solToTx(signature, tx);
}

async function getSolAddress(address: string): Promise<ExplorerAddress> {
  const [balance, sigs] = await Promise.all([
    solRpc<{ value?: number }>('getBalance', [address]),
    solRpc<Array<{ signature: string; slot?: number; blockTime?: number; err?: unknown }>>(
      'getSignaturesForAddress',
      [address, { limit: MAX_TXS }]
    ).catch(() => []),
  ]);

  return {
    address,
    chainId: 'sol',
    balance: fromBaseUnits(balance.value ?? 0, 9),
    txCount: sigs.length,
    // Fetching each transaction would be one RPC call per row against an
    // endpoint that throttles aggressively, so the list is built from the
    // signature index alone and amounts are left to the detail page.
    transactions: sigs.map((s) => ({
      hash: s.signature,
      chainId: 'sol',
      status: s.err ? ('failed' as const) : ('confirmed' as const),
      blockHeight: s.slot ?? null,
      timestamp: s.blockTime ? new Date(s.blockTime * 1000).toISOString() : null,
      confirmations: null,
      fee: null,
      amount: '',
      transfers: [],
    })),
  };
}

async function getSolBlock(ref: string): Promise<ExplorerBlock> {
  const slot = Number(ref);
  if (!Number.isFinite(slot)) throw new NotFoundError();
  const block = await solRpc<{
    blockhash?: string;
    blockTime?: number | null;
    blockHeight?: number | null;
    signatures?: string[];
  }>('getBlock', [
    slot,
    { transactionDetails: 'signatures', rewards: false, maxSupportedTransactionVersion: 0 },
  ]);

  return {
    chainId: 'sol',
    height: block.blockHeight ?? slot,
    hash: block.blockhash ?? '',
    timestamp: block.blockTime ? new Date(block.blockTime * 1000).toISOString() : null,
    txCount: block.signatures?.length ?? null,
    txHashes: block.signatures?.slice(0, MAX_TXS),
  };
}

// ── XRP Ledger ──────────────────────────────────────────────────────────────

const XRP_RPC = process.env.XRP_RPC_URL || 'https://xrplcluster.com';

interface XrpTx {
  hash?: string;
  Account?: string;
  Destination?: string;
  /** Drops as a string for XRP; an object for an issued currency. */
  Amount?: string | { value?: string; currency?: string };
  Fee?: string;
  ledger_index?: number;
  date?: number;
}

function xrpAmount(amount: XrpTx['Amount']): string {
  // An issued currency (USD, an IOU) reports a decimal value already; only
  // native XRP is denominated in drops.
  if (amount && typeof amount === 'object') return amount.value ?? '0';
  return fromBaseUnits(amount ?? 0, 6);
}

function xrpToTx(tx: XrpTx, meta: unknown, validated?: boolean): ExplorerTransaction {
  const result =
    meta && typeof meta === 'object' && 'TransactionResult' in meta
      ? String((meta as { TransactionResult: unknown }).TransactionResult)
      : undefined;
  const amount = xrpAmount(tx.Amount);

  return {
    hash: tx.hash ?? '',
    chainId: 'xrp',
    status: result && result !== 'tesSUCCESS' ? 'failed' : validated ? 'confirmed' : 'pending',
    blockHeight: tx.ledger_index ?? null,
    timestamp: tx.date ? new Date((tx.date + RIPPLE_EPOCH_OFFSET) * 1000).toISOString() : null,
    confirmations: null,
    fee: tx.Fee ? fromBaseUnits(tx.Fee, 6) : null,
    amount,
    transfers: [{ from: tx.Account ?? null, to: tx.Destination ?? null, amount }],
  };
}

async function getXrpTransaction(hash: string): Promise<ExplorerTransaction> {
  const body = await postJson<{
    result?: XrpTx & { meta?: unknown; validated?: boolean; error?: string };
  }>(XRP_RPC, { method: 'tx', params: [{ transaction: hash, binary: false }] });
  const r = body.result;
  if (!r || r.error) throw new NotFoundError();
  return xrpToTx(r, r.meta, r.validated);
}

async function getXrpAddress(address: string): Promise<ExplorerAddress> {
  const [info, history] = await Promise.all([
    postJson<{ result?: { account_data?: { Balance?: string }; error?: string } }>(XRP_RPC, {
      method: 'account_info',
      params: [{ account: address, ledger_index: 'validated' }],
    }),
    postJson<{
      result?: { transactions?: Array<{ tx?: XrpTx; meta?: unknown; validated?: boolean }> };
    }>(XRP_RPC, { method: 'account_tx', params: [{ account: address, limit: MAX_TXS }] }).catch(
      () => ({ result: { transactions: [] } })
    ),
  ]);

  if (info.result?.error === 'actNotFound') throw new NotFoundError();

  return {
    address,
    chainId: 'xrp',
    balance: fromBaseUnits(info.result?.account_data?.Balance ?? 0, 6),
    txCount: history.result?.transactions?.length ?? null,
    transactions: (history.result?.transactions || [])
      .filter((e) => e.tx)
      .map((e) => xrpToTx(e.tx as XrpTx, e.meta, e.validated)),
  };
}

async function getXrpBlock(ref: string): Promise<ExplorerBlock> {
  const isHeight = /^\d+$/.test(ref);
  const body = await postJson<{
    result?: {
      ledger?: {
        ledger_hash?: string;
        ledger_index?: number | string;
        close_time_iso?: string;
        transactions?: string[];
      };
      error?: string;
    };
  }>(XRP_RPC, {
    method: 'ledger',
    params: [
      isHeight
        ? { ledger_index: Number(ref), transactions: true }
        : { ledger_hash: ref, transactions: true },
    ],
  });

  const ledger = body.result?.ledger;
  if (!ledger || body.result?.error) throw new NotFoundError();

  return {
    chainId: 'xrp',
    height: Number(ledger.ledger_index ?? 0),
    hash: ledger.ledger_hash ?? '',
    timestamp: ledger.close_time_iso ?? null,
    txCount: ledger.transactions?.length ?? null,
    txHashes: ledger.transactions?.slice(0, MAX_TXS),
  };
}

// ── Cardano: Koios ──────────────────────────────────────────────────────────

const KOIOS = 'https://api.koios.rest/api/v1';

interface KoiosTx {
  tx_hash: string;
  block_height?: number;
  tx_timestamp?: number;
  fee?: string;
  total_output?: string;
  inputs?: Array<{ payment_addr?: { bech32?: string } }>;
  outputs?: Array<{ payment_addr?: { bech32?: string }; value?: string }>;
}

function koiosToTx(tx: KoiosTx): ExplorerTransaction {
  return {
    hash: tx.tx_hash,
    chainId: 'ada',
    status: tx.block_height ? 'confirmed' : 'pending',
    blockHeight: tx.block_height ?? null,
    timestamp: tx.tx_timestamp ? new Date(tx.tx_timestamp * 1000).toISOString() : null,
    confirmations: null,
    fee: tx.fee ? fromBaseUnits(tx.fee, 6) : null,
    amount: fromBaseUnits(tx.total_output ?? sumBaseUnits((tx.outputs || []).map((o) => o.value)), 6),
    transfers: (tx.outputs || []).map((o) => ({
      from: tx.inputs?.[0]?.payment_addr?.bech32 ?? null,
      to: o.payment_addr?.bech32 ?? null,
      amount: fromBaseUnits(o.value ?? 0, 6),
    })),
  };
}

async function getAdaTransaction(hash: string): Promise<ExplorerTransaction> {
  const rows = await postJson<KoiosTx[]>(`${KOIOS}/tx_info`, { _tx_hashes: [hash] });
  if (!rows?.length) throw new NotFoundError();
  return koiosToTx(rows[0]);
}

async function getAdaAddress(address: string): Promise<ExplorerAddress> {
  const [info, txRefs] = await Promise.all([
    postJson<Array<{ balance?: string }>>(`${KOIOS}/address_info`, { _addresses: [address] }),
    postJson<Array<{ tx_hash: string; block_height?: number; block_time?: number }>>(
      `${KOIOS}/address_txs`,
      { _addresses: [address] }
    ).catch(() => []),
  ]);

  if (!info?.length) throw new NotFoundError();

  // address_txs returns references only. Resolving all of them would be one
  // more round trip per row, so the most recent page is fetched in a single
  // tx_info call and the rest are left off.
  const recent = txRefs
    .sort((a, b) => (b.block_height ?? 0) - (a.block_height ?? 0))
    .slice(0, MAX_TXS);

  let transactions: ExplorerTransaction[] = [];
  if (recent.length) {
    const full = await postJson<KoiosTx[]>(`${KOIOS}/tx_info`, {
      _tx_hashes: recent.map((r) => r.tx_hash),
    }).catch(() => []);
    transactions = full.map(koiosToTx);
  }

  return {
    address,
    chainId: 'ada',
    balance: fromBaseUnits(info[0].balance ?? 0, 6),
    txCount: txRefs.length,
    transactions,
  };
}

async function getAdaBlock(ref: string): Promise<ExplorerBlock> {
  const isHeight = /^\d+$/.test(ref);
  let hash = ref;

  if (isHeight) {
    // Koios addresses blocks by hash, so a height has to be resolved first.
    const resp = await fetchWithTimeout(`${KOIOS}/blocks?block_height=eq.${ref}&limit=1`);
    if (!resp.ok) throw new UpstreamError(`HTTP ${resp.status}`);
    const rows = (await resp.json()) as Array<{ hash?: string }>;
    if (!rows?.length || !rows[0].hash) throw new NotFoundError();
    hash = rows[0].hash;
  }

  const rows = await postJson<
    Array<{ hash: string; block_height?: number; block_time?: number; tx_count?: number }>
  >(`${KOIOS}/block_info`, { _block_hashes: [hash] });
  if (!rows?.length) throw new NotFoundError();
  const b = rows[0];

  return {
    chainId: 'ada',
    height: b.block_height ?? 0,
    hash: b.hash,
    timestamp: b.block_time ? new Date(b.block_time * 1000).toISOString() : null,
    txCount: b.tx_count ?? null,
  };
}

// ── Dispatch ────────────────────────────────────────────────────────────────

export async function getMiscTransaction(
  chainId: string,
  hash: string
): Promise<ExplorerTransaction> {
  if (chainId === 'sol') return getSolTransaction(hash);
  if (chainId === 'xrp') return getXrpTransaction(hash);
  return getAdaTransaction(hash);
}

export async function getMiscAddress(chainId: string, address: string): Promise<ExplorerAddress> {
  if (chainId === 'sol') return getSolAddress(address);
  if (chainId === 'xrp') return getXrpAddress(address);
  return getAdaAddress(address);
}

export async function getMiscBlock(chainId: string, ref: string): Promise<ExplorerBlock> {
  if (chainId === 'sol') return getSolBlock(ref);
  if (chainId === 'xrp') return getXrpBlock(ref);
  return getAdaBlock(ref);
}
